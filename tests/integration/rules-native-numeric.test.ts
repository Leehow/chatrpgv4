/** Numeric edge responsibilities from the original controllers, independent of live gameplay. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {round,fixed} from '../play/numeric.ts';
import {_rate} from '../play/band-shadow-report.ts';
import {METRICS,rate} from '../play/persona-metrics.ts';
import {sidecar_metrics} from '../play/persona-report.ts';
import {importSource} from './support.ts';
const canonical=await importSource('kernel-ts/read/values.ts');
test('native_round_preserves_binary64_ties_and_near_ties',()=>{
  for(const [value,digits,expected] of [[.5,0,0],[1.5,0,2],[2.5,0,2],[-1.5,0,-2],[-2.5,0,-2],[.125,2,.12],[2.675,2,2.67],[1.005,2,1],[.03125,4,.0312],[.5000000001,0,1],[.4999999999,0,0],[85,-1,80],[95,-1,100]]){
    assert.equal(round(value,digits),expected);
    assert.equal(round(value,digits),canonical.round(value,digits));
  }
});
test('native_round_preserves_zero_extremes_and_nonfinite_boundaries',()=>{
  assert.equal(round(-.5),0);assert.ok(Object.is(round(-.5,0),-0));
  assert.equal(round(1e308,1),1e308);assert.equal(round(Number.MIN_VALUE,323),0);
  assert.equal(round(1,324),1);assert.ok(Object.is(round(-1,-309),-0));
  assert.throws(()=>round(Infinity),RangeError);assert.equal(round(Infinity,2),Infinity);
  assert.throws(()=>round(1,1.5),TypeError);
});
test('native_band_rates_retain_even_tie_rounding',()=>assert.equal(_rate(1,16),.062));
test('native_persona_verdict_rates_retain_even_tie_rounding',()=>{
  const id=Object.keys(METRICS).find(id=>METRICS[id].direction==='higher_is_better')!;
  assert.equal(rate(id,1,31),.0312);
});
test('native_persona_sidecar_medians_retain_even_tie_rounding',()=>{
  assert.equal(sidecar_metrics([{phase:'play',private_eval:{confusion:.125}}]).confusion,.12);
});
import {nativeAssertions,pyEqual} from './rules-play-support.ts';
test('native_approx_preserves_relative_absolute_and_array_tolerances',()=>{
  assert.equal(pyEqual([1.0000005,.2000001],[nativeAssertions.approx(1),nativeAssertions.approx(.2)]),true);
  assert.equal(pyEqual([1.000002],[nativeAssertions.approx(1)]),false);
  assert.equal(pyEqual(5e-13,nativeAssertions.approx(0)),true);
  assert.equal(pyEqual(2e-12,nativeAssertions.approx(0)),false);
  assert.equal(pyEqual([1,2.000001],nativeAssertions.approx([1,2])),true);
  assert.equal(pyEqual([1],nativeAssertions.approx([1,2])),false);
});
test('native_approx_preserves_infinity_nan_and_exact_non_numeric_members',()=>{
  assert.equal(pyEqual(Infinity,nativeAssertions.approx(Infinity)),true);
  assert.equal(pyEqual(1e308,nativeAssertions.approx(Infinity)),false);
  assert.equal(pyEqual(NaN,nativeAssertions.approx(NaN)),false);
  assert.equal(pyEqual(NaN,nativeAssertions.approx(NaN,{nan_ok:true})),true);
  assert.equal(pyEqual('1',nativeAssertions.approx(1)),false);
});
import {PersonaPlayer} from '../play/player.ts';
import {temporaryPath} from './npc-support.ts';
import {ROOT} from './support.ts';
import {relative,isAbsolute,join} from 'node:path';
import {mkdirSync,realpathSync} from 'node:fs';
test('native_persona_sandbox_stays_outside_repo_with_repo_tmpdir',async t=>{
  const previous=process.env.TMPDIR,within=join(ROOT,'.tmp','persona-sandbox-boundary');mkdirSync(within,{recursive:true});process.env.TMPDIR=within;
  t.after(()=>{if(previous===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previous;});
  const player=new PersonaPlayer({id:'boundary',name:'Boundary',motivations:{}},String(temporaryPath(t)));
  try{const path=relative(realpathSync(ROOT),realpathSync(player._sandbox));assert.ok(path==='..'||path.startsWith('../')||isAbsolute(path));}
  finally{await player.stop();}
});
import {control_socket_path} from '../play/driver.ts';
test('native_control_socket_preserves_identity_under_long_tmpdir',t=>{
  const previous=process.env.TMPDIR;process.env.TMPDIR=join(ROOT,'.tmp','x'.repeat(150));
  try{const one=control_socket_path('transport-boundary');assert.ok(Buffer.byteLength(one,'utf8')<104);assert.equal(control_socket_path('transport-boundary'),one);assert.notEqual(control_socket_path('other-boundary'),one);}
  finally{if(previous===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previous;}
});

test("native_driver_decimal_display_retains_even_ties",()=>{assert.equal(fixed(2.25,1),"2.2");assert.equal(fixed(-2.25,1),"-2.2");assert.equal(fixed(-.01,1),"-0.0");});
