import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {loadSharedFrontend} from '../../tools/verify-browser-frontend-parity.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const executable=`${root}build/private-ui-compilation-form`;
const components=['vkf_browser_host_policy','vkf_lexer_cursor_smoke',
  'vkf_parser_token_stream_smoke','vkf_ast_to_ir_smoke','vkf_csv_demand_source_scanner'];
const built=spawnSync('g++',['-std=c++17','-O1',`-I${root}`,`-I${root}native/VfOverlay`,
  `-I${root}build/shared-compiler`,`${root}tests/bootstrap/fixtures/ui-compilation-form.cpp`,
  ...components.map(name=>`${root}build/shared-compiler/native/compiler/native/${name}.o`),
  `${root}build/shared-compiler/native/native/VfOverlay/vf/json.o`,'-o',executable],
  {encoding:'utf8',timeout:30_000,windowsHide:true});
const production=loadSharedFrontend();
const inspection=loadSharedFrontend('build/shared-ui-probe');
const source=`: .ui.display
:.math
display:Display()
frame:display.add_frame(pos:[0.08,0.08],size:[0.84,0.84])
x:0.1[..100]
y:sin(x)
frame.add(x_u:x,y_u:y,id:"before",color:[0.12,0.72,1,1])
.y:y+1
frame.add(x_u:x,y_u:y,id:"after",color:[0.12,0.72,1,1])
`;

test('production-owned private compilation retains UI sites without altering canonical responses',async()=>{
  assert.equal(built.error,undefined,built.error?.message);
  assert.equal(built.status,0,built.stderr);
  const probe=spawnSync(executable,[],{input:source,encoding:'utf8',timeout:30_000,windowsHide:true});
  assert.equal(probe.error,undefined,probe.error?.message);
  assert.equal(probe.status,0,probe.stderr);
  const form=JSON.parse(probe.stdout);
  assert.equal(JSON.stringify(form.canonical),JSON.stringify(form.original),
    'the original native lower_value remains the independent canonical contract');
  const publicApi=await production;
  const canonical=publicApi.native(source);
  assert.equal(canonical.ok,true,canonical.message);
  assert.deepEqual(publicApi.browser(source),canonical);
  assert.equal(JSON.stringify(form.canonical),JSON.stringify(canonical.typed_ir));
  assert.deepEqual(Object.keys(canonical).sort(),['ok','typed_ir']);
  assert.equal(JSON.stringify(form.canonical).includes('retained_ui_effect'),false);
  const privateApi=await inspection;
  for(const response of [privateApi.native(source),privateApi.browser(source)]){
    assert.equal(response.ok,true,response.message);
    assert.deepEqual(response.typed_ir,form.canonical);
    assert.deepEqual(response.execution_ir,form.execution);
  }
  const body=form.execution.body;
  const effects=body.map((statement,index)=>({value:statement.value??statement.expr,index}))
    .filter(({value})=>value?.kind==='retained_ui_effect');
  const adds=effects.filter(({value})=>form.execution.ui_program.operations[value.operation_index]?.kind==='add');
  assert.equal(adds.length,2);
  const update=body.findIndex(statement=>statement.name==='y'&&statement.update);
  assert.ok(adds[0].index<update&&update<adds[1].index);
  assert.deepEqual(adds[0].value.arguments.map(argument=>argument.name),['x_u','y_u','id','color']);
});
