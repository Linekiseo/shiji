import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isValidBackup} from '../src/backup.ts';
import {localDay,localTimestamp} from '../src/dates.ts';
const task=()=>({id:'task',title:'测试事项',description:'完整正文',tag:'未分类',status:'todo',createdAt:'2026-09-17T10:00:00+08:00',entries:[{id:'entry',at:'2026-09-17T10:00:00+08:00',kind:'created',status:'todo',text:'测试事项'}]});
const backup=(items:unknown[])=>({version:1,items});
test('empty and legacy text backups remain compatible',()=>{assert.equal(isValidBackup(backup([])),true);assert.equal(isValidBackup(backup([task()])),true);});
test('portable photo and recorded Opus data survive validation',()=>{
  const work=task();Object.assign(work.entries[0],{attachments:[{id:'p',kind:'photo',name:'图片',src:'data:image/png;base64,YWJj'},{id:'a',kind:'audio',name:'录音',src:'data:audio/webm;codecs=opus;base64,YWJj'}]});
  assert.equal(isValidBackup(backup([work])),true);
});
test('invalid backups cannot introduce empty histories or remote/private media requests',()=>{
  assert.equal(isValidBackup(backup([{...task(),entries:[]}])),false);
  for(const src of ['https://example.com/image.png','file:///private/file','javascript:alert(1)','data:text/html;base64,YWJj']){
    const work=task();Object.assign(work.entries[0],{attachments:[{id:'x',kind:'photo',name:'x',src}]});assert.equal(isValidBackup(backup([work])),false);
  }
});
test('duplicate ids, orphan events and third-level subtasks are rejected',()=>{
  assert.equal(isValidBackup(backup([task(),task()])),false);
  const work=task();Object.assign(work.entries[0],{subtaskId:'missing'});assert.equal(isValidBackup(backup([work])),false);
  const nested={...task(),subtasks:[{id:'child',title:'子任务',status:'todo',createdAt:task().createdAt,subtasks:[]}]};assert.equal(isValidBackup(backup([nested])),false);
});
test('local timestamps preserve the actual instant including milliseconds and offset',()=>{
  for(const iso of ['2026-09-17T23:59:59.321Z','2026-01-01T00:00:00.000Z']){
    const date=new Date(iso);assert.equal(Date.parse(localTimestamp(date)),date.getTime());assert.equal(localTimestamp(date).slice(0,10),localDay(date));
  }
});
