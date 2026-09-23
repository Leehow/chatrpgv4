/**
 * Static scan behind the SL-00 control-flow inventory (docs/specs/pi-native-single-loop-tickets/).
 *
 * It walks the host trees and reports every call that can start, continue or drive a model run,
 * keyed by file and by the nearest named enclosing symbol -- never by line, so the inventory
 * survives ordinary edits. What counts as such a call is structural (callee names, receiver names,
 * literal flags), not a reading of any text.
 *
 * Kinds:
 * - agent-run          `<agent|session>.prompt(...)` / `.continue(...)`
 * - trigger-turn       `sendMessage(msg, opts)` unless `opts` is a literal with `triggerTurn: false` (see sendMode),
 *                      and every `sendUserMessage(...)`
 * - rpc-run-command    an object literal whose `type` is (or can be) "prompt" | "steer" | "follow_up"
 * - session-host       `createAgentSession*(...)`, `createAgentSessionRuntime(...)`, `runRpcMode(...)`, `runPrintMode(...)`
 * - task-runtime       `new TaskRuntime(...)`, `.submit(...)`, `.begin(...)`, `this.#run(...)`
 * - reader-task        `runReader(...)`, `runTask(...)` / `.runTask(...)`
 * - lane               `runLane(...)`
 * - present-document   `presentDocument(...)`
 * - jev-adapter        `createDecisionAdapter(...)`, `createS0Decider(...)`
 * - jev-loop           `runEvidenceAgent(...)`, `runPrescreenLoop(...)` (host-side decision/read loops)
 * - provider-direct    `.complete(...)`, `completeSimple(...)`, `streamSimple(...)`, `streamFn(...)`, `generateImage(...)`
 * - network            any reference to the global `fetch`
 * - spawn              `spawn(...)`, `.spawn(...)`, `.spawnImpl(...)` (child processes; Pi children among them)
 */
import ts from 'typescript';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join, relative, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TREES = ['extensions', 'runtime', 'pipicoc', 'Electron/packages/pi-backend/src'];
const SOURCE = /\.(ts|mts|cts|js|mjs|cjs)$/;

export function sourceFiles(root = REPO, trees = TREES) {
  const files = [];
  for (const tree of trees) {
    const base = join(root, tree);
    let entries;
    try { entries = readdirSync(base, {recursive: true, withFileTypes: true}); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isFile() || !SOURCE.test(entry.name) || entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.mts')) continue;
      const path = join(entry.parentPath ?? entry.path, entry.name);
      if (path.includes(`${'/'}node_modules${'/'}`)) continue;
      // A stray emit beside its own source (extensions/kernel/client.js next to client.ts, gitignored) is the
      // same code twice; the inventory names the source, so the emit is skipped rather than double-counted.
      if (/\.(js|mjs|cjs)$/.test(entry.name) && existsSync(path.replace(/\.(js|mjs|cjs)$/, (_, ext) => ({js: '.ts', mjs: '.mts', cjs: '.cts'})[ext]))) continue;
      files.push(path);
    }
  }
  return files.sort();
}

const RUN_TYPES = new Set(['prompt', 'steer', 'follow_up']);
const SESSION_HOSTS = new Set(['createAgentSession', 'createAgentSessionFromServices', 'createAgentSessionRuntime', 'runRpcMode', 'runPrintMode']);
const IDENT_KINDS = new Map(Object.entries({
  runReader: 'reader-task', runTask: 'reader-task', runLane: 'lane', presentDocument: 'present-document',
  createDecisionAdapter: 'jev-adapter', createS0Decider: 'jev-adapter',
  runEvidenceAgent: 'jev-loop', runPrescreenLoop: 'jev-loop',
  completeSimple: 'provider-direct', streamSimple: 'provider-direct', streamFn: 'provider-direct', generateImage: 'provider-direct',
  spawn: 'spawn',
  // The kernel extension's one wrapper around `pi.sendMessage(..., {triggerTurn: true})`: its callers are the drivers.
  sendHost: 'trigger-turn',
}));
const METHOD_KINDS = new Map(Object.entries({
  runTask: 'reader-task', complete: 'provider-direct', completeSimple: 'provider-direct', streamSimple: 'provider-direct',
  streamFn: 'provider-direct', submit: 'task-runtime', begin: 'task-runtime', spawn: 'spawn', spawnImpl: 'spawn',
}));

function nameOf(node) {
  if (!node) return undefined;
  if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  if (ts.isComputedPropertyName(node)) return undefined;
  return undefined;
}

/** Nearest named enclosing symbol, qualified by its class or object owner: `Class.method`, `outer`, `<module>`. */
function enclosingSymbol(node) {
  const parts = [];
  for (let at = node.parent; at; at = at.parent) {
    let name;
    if (ts.isFunctionDeclaration(at) || ts.isClassDeclaration(at) || ts.isClassExpression(at)) name = nameOf(at.name);
    else if (ts.isMethodDeclaration(at) || ts.isGetAccessorDeclaration(at) || ts.isSetAccessorDeclaration(at)
      || ts.isPropertyDeclaration(at)) name = nameOf(at.name);
    else if (ts.isConstructorDeclaration(at)) name = 'constructor';
    else if ((ts.isArrowFunction(at) || ts.isFunctionExpression(at))) {
      const holder = at.parent;
      if (ts.isVariableDeclaration(holder) || ts.isPropertyAssignment(holder) || ts.isPropertyDeclaration(holder)) {
        name = nameOf(holder.name);
        if (name !== undefined) at = holder;
      } else if (ts.isFunctionExpression(at) && at.name) name = nameOf(at.name);
      else if (ts.isCallExpression(holder) && holder.arguments.includes(at) && holder.arguments[0] !== at) {
        // A handler registered under a literal name: `pi.on("agent_end", fn)`, `registerCommand("coc", fn)`.
        const first = holder.arguments[0];
        const label = first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) ? first.text : undefined;
        const callee = ts.isPropertyAccessExpression(holder.expression) ? holder.expression.name.text
          : ts.isIdentifier(holder.expression) ? holder.expression.text : undefined;
        if (label !== undefined && callee !== undefined) name = `${callee}(${label})`;
      }
    }
    if (name === undefined) continue;
    parts.unshift(name);
    // A method or class member: qualify by its class once, then stop.
    if (ts.isClassDeclaration(at) || ts.isClassExpression(at)) break;
    if ((ts.isMethodDeclaration(at) || ts.isPropertyDeclaration(at) || ts.isConstructorDeclaration(at)
      || ts.isGetAccessorDeclaration(at) || ts.isSetAccessorDeclaration(at)) && at.parent && ts.isClassLike(at.parent)) {
      const owner = nameOf(at.parent.name);
      if (owner) parts.unshift(owner);
      break;
    }
    if (ts.isFunctionDeclaration(at)) break;
  }
  return parts.length ? parts.join('.') : '<module>';
}

function receiverName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isNonNullExpression(expression) || ts.isParenthesizedExpression(expression)) return receiverName(expression.expression);
  if (ts.isCallExpression(expression)) return receiverName(expression.expression);
  if (expression.kind === ts.SyntaxKind.ThisKeyword) return 'this';
  return undefined;
}

function literalStrings(node, out = []) {
  if (!node) return out;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
  else if (ts.isConditionalExpression(node)) { literalStrings(node.whenTrue, out); literalStrings(node.whenFalse, out); }
  else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression?.(node)) literalStrings(node.expression, out);
  return out;
}

/**
 * What a `sendMessage(message, options)` does to a run, read off the options literal alone.
 * `triggerTurn: false` never starts or extends a run; a truthy flag starts one when idle and steers
 * the live run otherwise; an absent flag (or absent options) is Pi's `agent.steer()` while a run is
 * streaming (AgentSession.sendCustomMessage), which buys one more provider request.
 */
function sendMode(options) {
  if (!options) return 'steer-when-streaming';
  if (!ts.isObjectLiteralExpression(options)) return 'dynamic';
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property)) return 'dynamic';
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
    if (nameOf(property.name) !== 'triggerTurn') continue;
    if (ts.isShorthandPropertyAssignment(property)) return 'dynamic';
    if (property.initializer.kind === ts.SyntaxKind.FalseKeyword) return undefined;
    if (property.initializer.kind === ts.SyntaxKind.TrueKeyword) return 'triggerTurn';
    return 'dynamic';
  }
  return 'steer-when-streaming';
}

/** The fetch identifier as a value (a call, a default, an argument), not as a property or a declaration. */
function isGlobalFetchReference(node) {
  if (!ts.isIdentifier(node) || node.text !== 'fetch') return false;
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return parent.expression.kind === ts.SyntaxKind.Identifier
    && parent.expression.text === 'globalThis';
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent)
    || ts.isPropertySignature(parent) || ts.isParameter(parent) || ts.isVariableDeclaration(parent)
    || ts.isFunctionDeclaration(parent) || ts.isImportSpecifier(parent) || ts.isBindingElement(parent)) && parent.name === node) return false;
  if (ts.isTypeQueryNode(parent) || ts.isTypeReferenceNode(parent) || ts.isQualifiedName(parent)) return false;
  return true;
}

export function scanFile(path, root = REPO) {
  const rel = relative(root, path).split('\\').join('/');
  const text = readFileSync(path, 'utf8');
  const kind = /\.(js|mjs|cjs)$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const sites = [];
  const add = (node, siteKind, callee) => sites.push({
    file: rel, symbol: enclosingSymbol(node), kind: siteKind, callee,
    line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
  });
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee)) {
        const name = callee.text;
        if (IDENT_KINDS.has(name)) add(node, IDENT_KINDS.get(name), name);
        else if (SESSION_HOSTS.has(name)) add(node, 'session-host', name);
        else if (name === 'sendUserMessage') add(node, 'trigger-turn', name);
        else if (name === 'sendMessage' && sendMode(node.arguments[1])) add(node, 'trigger-turn', `sendMessage{${sendMode(node.arguments[1])}}`);
      } else if (ts.isPropertyAccessExpression(callee)) {
        const method = callee.name.text;
        const receiver = receiverName(callee.expression) ?? '';
        if (ts.isPrivateIdentifier(callee.name) && method === '#run') add(node, 'task-runtime', '#run');
        else if ((method === 'prompt' || method === 'continue') && /agent|session/i.test(receiver)) add(node, 'agent-run', `${receiver}.${method}`);
        else if (method === 'sendUserMessage') add(node, 'trigger-turn', `${receiver}.sendUserMessage`);
        else if (method === 'sendMessage' && sendMode(node.arguments[1])) add(node, 'trigger-turn', `${receiver}.sendMessage{${sendMode(node.arguments[1])}}`);
        else if (SESSION_HOSTS.has(method)) add(node, 'session-host', method);
        else if (METHOD_KINDS.has(method)) add(node, METHOD_KINDS.get(method), `${receiver}.${method}`);
        else if (IDENT_KINDS.has(method) && IDENT_KINDS.get(method) !== 'spawn') add(node, IDENT_KINDS.get(method), `${receiver}.${method}`);
      }
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'TaskRuntime') {
      add(node, 'task-runtime', 'new TaskRuntime');
    } else if (ts.isPropertyAssignment(node) && nameOf(node.name) === 'type'
      && literalStrings(node.initializer).some(value => RUN_TYPES.has(value))) {
      add(node, 'rpc-run-command', `{type: ${literalStrings(node.initializer).filter(value => RUN_TYPES.has(value)).join('|')}}`);
    } else if (isGlobalFetchReference(node)) {
      add(node, 'network', ts.isPropertyAccessExpression(node.parent) ? 'globalThis.fetch' : 'fetch');
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return sites;
}

export function scanControlFlow(root = REPO, trees = TREES) {
  return sourceFiles(root, trees).flatMap(path => scanFile(path, root));
}

/** One inventory key per (file, symbol, kind, callee). */
export const siteKey = site => `${site.file}#${site.symbol}#${site.kind}#${site.callee}`;
