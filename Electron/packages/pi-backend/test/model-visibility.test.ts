import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createPiHostBackend } from "../src/index.js";

describe("model visibility persistence",()=>{let root="";afterEach(async()=>{if(root)await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:25})});it("returns [] for a missing file, round-trips explicit acknowledgements, and rejects invalid data",async()=>{root=await mkdtemp(join(tmpdir(),"pipi-vis-"));const agent=join(root,"agent");await mkdir(agent,{recursive:true});const backend=createPiHostBackend({agentDir:agent});expect(await backend.handle("getHiddenModelIds",[])).toEqual([]);const saved=await backend.handle("setHiddenModelIds",[["openai/gpt-5","anthropic/claude-sonnet-4","openai/gpt-5"]]);expect(saved).toEqual(["anthropic/claude-sonnet-4","openai/gpt-5"]);expect(await backend.handle("getHiddenModelIds",[])).toEqual(["anthropic/claude-sonnet-4","openai/gpt-5"]);const onDisk=JSON.parse(await readFile(join(agent,"pipiui-settings.json"),"utf8"));expect(onDisk).toEqual({hiddenModelIds:["anthropic/claude-sonnet-4","openai/gpt-5"]});await (backend as unknown as {materializeSubagentModelCatalog():Promise<void>}).materializeSubagentModelCatalog();const leftovers=(await readdir(agent)).filter(name=>name.includes(".tmp-"));expect(leftovers).toEqual([]);const fresh=createPiHostBackend({agentDir:agent});expect(await fresh.handle("getHiddenModelIds",[])).toEqual(["anthropic/claude-sonnet-4","openai/gpt-5"]);await expect(fresh.handle("setHiddenModelIds",[undefined])).rejects.toThrow("hiddenModelIds 必须是 string[]");const invalidAgent=join(root,"invalid-agent");await mkdir(invalidAgent,{recursive:true});await writeFile(join(invalidAgent,"pipiui-settings.json"),JSON.stringify({hiddenModelIds:["openai/gpt-5",42]}));await expect(createPiHostBackend({agentDir:invalidAgent}).handle("getHiddenModelIds",[])).rejects.toThrow("hiddenModelIds 必须是 string[]");});});

describe("semantic sidebar preference persistence",()=>{let root="";afterEach(async()=>{if(root)await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:25})});it("atomically merges into pipiui-settings without clobbering model fields",async()=>{root=await mkdtemp(join(tmpdir(),"pipi-sidebar-pref-"));const agent=join(root,"agent");await mkdir(agent,{recursive:true});await writeFile(join(agent,"pipiui-settings.json"),JSON.stringify({hiddenModelIds:["openai/gpt-5"],subagentModels:{worker:[{model:"gpt-5"}]}}));const backend=createPiHostBackend({agentDir:agent});expect(await backend.handle("getSidebarSessionPreferences",[])).toEqual({pinnedSessionIds:[],archivedSessionIds:[],orderedSessionIds:[]});expect(await backend.handle("setSidebarSessionPreferences",[{pinnedSessionIds:["s1","s2","s1"],archivedSessionIds:["s2","s3"],orderedSessionIds:["s3","s1","s3"],sessionOrderVersion:2}])).toEqual({pinnedSessionIds:["s1"],archivedSessionIds:["s2","s3"],orderedSessionIds:["s3","s1"],sessionOrderVersion:2});const saved=JSON.parse(await readFile(join(agent,"pipiui-settings.json"),"utf8"));expect(saved).toMatchObject({hiddenModelIds:["openai/gpt-5"],subagentModels:{worker:[{model:"gpt-5"}]},sidebarSessionPreferences:{pinnedSessionIds:["s1"],archivedSessionIds:["s2","s3"],orderedSessionIds:["s3","s1"],sessionOrderVersion:2}});await (backend as unknown as {materializeSubagentModelCatalog():Promise<void>}).materializeSubagentModelCatalog();expect((await readdir(agent)).filter(name=>name.includes(".tmp-"))).toEqual([]);await expect(backend.handle("setSidebarSessionPreferences",[{pinnedSessionIds:[1],archivedSessionIds:[],orderedSessionIds:[]}])).rejects.toThrow("pinnedSessionIds");});});

describe("archive retention metadata persistence",()=>{let root="";afterEach(async()=>{if(root)await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:25})});it("round-trips timestamps only for archived sessions and rejects invalid values",async()=>{root=await mkdtemp(join(tmpdir(),"pipi-archive-retention-"));const agent=join(root,"agent");await mkdir(agent,{recursive:true});const backend=createPiHostBackend({agentDir:agent});const saved=await backend.handle("setSidebarSessionPreferences",[{pinnedSessionIds:[],archivedSessionIds:["old","legacy"],archivedSessionTimestamps:{old:1234,notArchived:1},orderedSessionIds:[],sessionOrderVersion:2}]);expect(saved).toEqual({pinnedSessionIds:[],archivedSessionIds:["old","legacy"],archivedSessionTimestamps:{old:1234},orderedSessionIds:[],sessionOrderVersion:2});expect(await backend.handle("getSidebarSessionPreferences",[])).toEqual(saved);await expect(backend.handle("setSidebarSessionPreferences",[{pinnedSessionIds:[],archivedSessionIds:["old"],archivedSessionTimestamps:{old:"yesterday"},orderedSessionIds:[]}])).rejects.toThrow("archivedSessionTimestamps");});});

describe("configured model image capability",()=>{
  let root="";
  afterEach(async()=>{if(root)await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:25})});
  it("reads image support from declared metadata and defaults absent metadata to multimodal",async()=>{
    root=await mkdtemp(join(tmpdir(),"pipi-image-cap-"));const agent=join(root,"agent");await mkdir(agent,{recursive:true});
    await writeFile(join(agent,"models.json"),JSON.stringify({providers:{
      textonly:{apiKey:"k",models:[{id:"text-model",input:["text"],reasoning:true}]},
      explicit:{apiKey:"k",models:[{id:"disabled-image",supportsImages:false,reasoning:true},{id:"text-wins",supportsImages:true,input:["text"],reasoning:true}]},
      openai:{apiKey:"k",models:[{id:"gpt-4o",reasoning:true}]},
      custom:{apiKey:"k",models:[{id:"image-model",input:["image","text"],reasoning:true}]},
    }}));
    const backend=createPiHostBackend({agentDir:agent});
    try {
      const models:any[]=await backend.handle("listModels",[]);
      expect(models.find(m=>m.id==="text-model")).toMatchObject({supportsImages:false});
      expect(models.find(m=>m.id==="disabled-image")).toMatchObject({supportsImages:false});
      expect(models.find(m=>m.id==="text-wins")).toMatchObject({supportsImages:false});
      expect(models.find(m=>m.id==="gpt-4o")).toMatchObject({supportsImages:true});
      expect(models.find(m=>m.id==="image-model")).toMatchObject({supportsImages:true});
    } finally {await backend.close();}
  });

  it("restores extension model vision from contributions and passes it to onboarding without reselection",async()=>{
    root=await mkdtemp(join(tmpdir(),"pipi-image-cold-restore-"));
    const agent=join(root,"agent"),cwd=join(root,"project"),sessions=join(root,"sessions"),dir=join(sessions,"--project--");
    await mkdir(join(agent,"extensions"),{recursive:true});await mkdir(cwd,{recursive:true});await mkdir(dir,{recursive:true});
    const extension=async(id:string,provider:any,capabilities:string[]=[])=>{
      const folder=join(agent,"extensions",id);await mkdir(folder,{recursive:true});
      await writeFile(join(folder,"pipiui-extension.json"),JSON.stringify({id,name:id,version:"1.0.0",capabilities,
        auth:provider?{provider}:undefined,defaultEnabled:true}));
    };
    await extension("deepseek",{id:"deepseek-extended",name:"DeepSeek Extended",models:[
      {id:"deepseek-flash",name:"DeepSeek Flash",input:["text","image"],reasoning:true},
    ]});
    await extension("grok-build-oauth",{id:"grok-build",name:"Grok Build",models:[
      {id:"grok-4.6",name:"Grok 4.6",input:["text","image"],reasoning:true},
    ]});
    await extension("future-provider",{id:"future-provider",name:"Future Provider",models:[
      {id:"future-auto",name:"Future Auto",reasoning:true},
      {id:"future-text",name:"Future Text",input:["text"],reasoning:true},
    ]});
    await extension("coc-keeper",null,["invoke.agent"]);
    const refs=[
      ["deep","deepseek-extended","deepseek-flash"],
      ["grok","grok-build","grok-4.6"],
      ["auto","future-provider","future-auto"],
      ["text","future-provider","future-text"],
      ["uncatalogued","missing-provider","missing-model"],
    ];
    for(const [id,provider,modelId] of refs)await writeFile(join(dir,`${id}.jsonl`),[
      {type:"session",version:3,id,timestamp:"2026-09-13T00:00:00.000Z",cwd},
      {type:"model_change",id:`model-${id}`,parentId:null,timestamp:"2026-09-13T00:00:01.000Z",provider,modelId},
    ].map(JSON.stringify).join("\n")+"\n");
    const runtimeModels=[
      {provider:"deepseek-extended",id:"deepseek-flash",name:"DeepSeek Flash",input:["text"],reasoning:true},
      {provider:"grok-build",id:"grok-4.6",name:"Grok 4.6",input:["text"],reasoning:true},
      {provider:"future-provider",id:"future-auto",name:"Future Auto",reasoning:true},
      {provider:"future-provider",id:"future-text",name:"Future Text",reasoning:true},
    ];
    const calls:any[]=[];
    const preparation={invoke:async(request:any,sessionId:string,model:any)=>{calls.push({request,sessionId,model});return {id:request.id,name:"Cold Harvest.pdf",state:"preparing"};},close:async()=>{}};
    const registry={get:()=>preparation,close:async()=>{}};
    const backend=createPiHostBackend({agentDir:agent,sessionsRoot:sessions,runtimeRoot:join(root,"runtime"),
      managedNodeModulesRoot:join(root,"repo","node_modules"),defaultPack:"coc-keeper",cocOnboardingRegistry:registry as any,
      authRuntime:{getProviders:async()=>[],getAvailable:async()=>runtimeModels,login:async()=>undefined,logout:async()=>undefined}});
    try {
      for(const id of ["deepseek","grok-build-oauth","future-provider","coc-keeper"])
        await backend.handle("setExtensionEnabled" as never,[id,true,"app"]);
      const models:any[]=await backend.handle("listModels",[]);
      expect(models.find(model=>model.provider==="deepseek-extended"&&model.id==="deepseek-flash")).toMatchObject({supportsImages:true});
      expect(models.find(model=>model.provider==="grok-build"&&model.id==="grok-4.6")).toMatchObject({supportsImages:true});
      expect(models.find(model=>model.provider==="future-provider"&&model.id==="future-auto")).toMatchObject({supportsImages:true});
      expect(models.find(model=>model.provider==="future-provider"&&model.id==="future-text")).toMatchObject({supportsImages:false});
      for(const id of ["deep","grok","auto","text"]) {
        const state:any=await backend.handle("getModelState",[id]);
        expect(state.model.supportsImages).toBe(id!=="text");
      }
      const uncatalogued:any=await backend.handle("getModelState",["uncatalogued"]);
      expect(uncatalogued.model).toMatchObject({provider:"missing-provider",id:"missing-model"});
      expect(uncatalogued.model.supportsImages).toBeUndefined();
      for(const id of ["deep","grok","uncatalogued","text"])
        await backend.handle("invokeExtension",["coc-keeper","onboarding",{action:"resume",id:"import"}, {sessionId:id}]);
      expect(calls.map(call=>[call.sessionId,call.model.vision])).toEqual([
        ["deep",true],["grok",true],["uncatalogued",true],["text",false],
      ]);
    } finally {await backend.close();}
  });
});

describe("prompt image attachments",()=>{let root="";afterEach(async()=>{if(root)await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:25})});it("writes attachments under <cwd>/.pi/attachments and sends the images RPC field",async()=>{root=await mkdtemp(join(tmpdir(),"pipi-img-"));const cwd=join(root,"project");const dir=join(root,"sessions","project");await mkdir(dir,{recursive:true});await mkdir(cwd,{recursive:true});const path=join(dir,"session.jsonl");await writeFile(path,JSON.stringify({type:"session",version:3,id:"session-1",timestamp:"2026-08-10T00:00:00.000Z",cwd})+"\n");const backend=createPiHostBackend({sessionsRoot:join(root,"sessions"),runtimeRoot:join(root,"runtime"),piPath:"node",spawn:(_bin,_args,options)=>spawn("/usr/local/bin/node",[new URL("./fake-pi.mjs",import.meta.url).pathname],{...options,env:{...options.env,PATH:"/usr/local/bin:/usr/bin:/bin"}}) as any});const logs:any[]=[];const off=backend.subscribe(e=>{if(e.channel==="agents"&&e.event.type==="agent_log"&&e.event.agentId==="agent-images")logs.push(e.event.text)});const attachment={dataBase64:Buffer.from("PNGDATA").toString("base64"),mimeType:"image/png",name:"shot.png"};await backend.handle("sendPrompt",["session-1","看图",[attachment]]);await new Promise(r=>setTimeout(r,20));off();expect(logs.some(text=>text.includes("IMAGES=")&&text.includes("\"type\":\"image\"")&&text.includes(attachment.dataBase64)&&text.includes("image/png"))).toBe(true);const written=await readFile(join(cwd,".pi","attachments","shot.png"),"utf8");expect(written).toBe("PNGDATA");});});
