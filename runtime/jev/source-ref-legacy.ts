/** Compatibility views materialize source values; no model is asked to echo existing text. */
import { ContractError, type SourceRef } from './contracts.ts';
import { resolveSourceRef, type SourceAccess } from './source-ref.ts';

export function sourceQuote(ref: SourceRef, access: SourceAccess): { quote: string; sourceRef: SourceRef } {
  const quote = resolveSourceRef(ref, access);
  if (typeof quote !== 'string') throw new ContractError('source_quote_not_text');
  return { quote, sourceRef: structuredClone(ref) };
}

/** A legacy record remains readable; a new reference-backed record materializes its exact statement. */
export function memoryStatementView<T extends { statement?: string; statementRef?: SourceRef }>(record: T, access: SourceAccess): T & { statement: string } {
  if (record.statementRef) return { ...record, statement: sourceQuote(record.statementRef, access).quote };
  if (typeof record.statement !== 'string') throw new ContractError('memory_statement_missing');
  return { ...record, statement: record.statement };
}
