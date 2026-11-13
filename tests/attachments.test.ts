import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createAttachmentStore } from "../src/server/attachments.ts";
import { setFileAccessPolicy } from "../src/agent/tools/file-access.ts";
import { createReadTool } from "../src/agent/tools/read.ts";
import { parseFilePaths } from "../src/core/index.ts";
import { insertFilePaths } from "../components/path-input-dom.ts";
import { uploadAttachmentFiles } from "../components/attachment-upload.ts";
import { MAX_ATTACHMENT_BYTES } from "../lib/attachment-limits.ts";
test("browser attachments persist safely and remain readable through the tutor tools", async () => {
const root=await fs.mkdtemp(path.join(os.tmpdir(),"owlly-attachment-tests-"));
try {
 const store=createAttachmentStore(path.join(root,"uploads"));
 const files=[new File(["first upload"],"report with spaces.txt"),new File(["second upload"],"report with spaces.txt"),new File(["unicode"],"résumé `v2`.md")];
 const saved=await store.save(files);
 assert.equal(saved.length,3);
 assert.notEqual(saved[0]!.path,saved[1]!.path);
 for(let i=0;i<files.length;i++) { assert.equal(path.basename(saved[i]!.path),files[i]!.name); assert.equal(await fs.readFile(saved[i]!.path,"utf8"),await files[i]!.text()); }
 const edit=insertFilePaths("Review these: ",{anchor:14,focus:14},saved.map(file=>file.path));
 assert.equal(parseFilePaths(edit.value).filter(part=>part.kind==="path").length,3);
 const read=await createReadTool().execute("attachment-check",{path:saved[0]!.path});
 assert.ok(read.content.some(block=>block.type==="text"&&block.text.includes("first upload")));
 await assert.rejects(store.save([new File(["bad"],"../escape.txt")]),/filename/);
 await assert.rejects(store.save([new File(["bad"],"bad\u2028name.txt")]),/filename/);
 await assert.rejects(store.save([new File([new Uint8Array(MAX_ATTACHMENT_BYTES+1)],"large.txt")]),/too large/);
 const cancel=new AbortController();cancel.abort();
 await assert.rejects(store.save([new File(["cancel"],"cancel.txt")],cancel.signal));
 const rollback=createAttachmentStore(path.join(root,"rollback"));
 const broken=new File(["x"],"broken.txt");broken.arrayBuffer=async()=>{throw new Error("read failed");};
 await assert.rejects(rollback.save([new File(["ok"],"ok.txt"),broken]),/read failed/);
 assert.deepEqual(await fs.readdir(path.join(root,"rollback")),[]);
 await fs.mkdir(path.join(root,"outside"));await fs.symlink(path.join(root,"outside"),path.join(root,"linked"));
 await assert.rejects(createAttachmentStore(path.join(root,"linked")).save([new File(["x"],"x.txt")]),/unavailable/);
 setFileAccessPolicy(()=>({restricted:true,folders:[path.join(root,"outside")]}));
 await assert.rejects(store.save([new File(["x"],"refused.txt")]),/File access/);
 setFileAccessPolicy(()=>({restricted:false,folders:[]}));
 const response=await uploadAttachmentFiles(files,new AbortController().signal,(async(_url,init)=>{
  const form=init!.body as FormData;assert.equal(form.getAll("files").length,3);
  return Response.json({attachments:saved},{status:201});
 }) as typeof fetch);
 assert.deepEqual(response,saved);
 await assert.rejects(uploadAttachmentFiles(files,new AbortController().signal,(async()=>Response.json({error:"Too large"},{status:413})) as typeof fetch),/Too large/);
 console.log("Passed upload persistence, duplicate/unicode filenames, chip insertion, tutor reading, traversal and size rejection, abort, rollback, symlink rejection, file-access restrictions, and client response checks.");
} finally { setFileAccessPolicy(()=>({restricted:false,folders:[]}));await fs.rm(root,{recursive:true,force:true}); }

});
