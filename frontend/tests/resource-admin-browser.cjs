const {chromium}=require(process.env.RESOURCE_PLAYWRIGHT_MODULE||'playwright')
const assert=require('node:assert/strict')
;(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.RESOURCE_BROWSER_PATH?{executablePath:process.env.RESOURCE_BROWSER_PATH}:{})})
 try{
 for(const mode of ['system','college','student']){
  const page=await browser.newPage({viewport:{width:1360,height:1000}}), errors=[],writes=[],queries=[]
  page.on('pageerror',e=>errors.push(e.message))
  let room={id:'9007199254740993',building:'测试楼',room_number:'101',college_id:'1',capacity:30,equipment:{projector:true,whiteboard:true},is_bookable_whole:false,open_time:'08:00:00',close_time:'22:00:00',status:'AVAILABLE'}, seats=[],reject=false
  await page.addInitScript(()=>localStorage.setItem('token','test-token'))
  await page.route('**/api/**',async route=>{
   const r=route.request(),u=new URL(r.url()),path=u.pathname
   let data
   if(path==='/api/d1/users/me')data={id:'1',college_id:'1',roles:mode==='system'?['SYSTEM_ADMIN']:mode==='college'?['CLASSROOM_ADMIN']:['STUDENT'],permissions:mode==='college'?['resource:manage']:[],status:'ACTIVE'}
   else if(path==='/api/d1/colleges')data=[{id:'1',name:'测试学院'}]
   else if(r.method()==='GET' && path==='/api/d2/classrooms'){queries.push(u.searchParams);data={items:[room],total:1,page:1,page_size:20}}
   else if(r.method()==='GET' && path.endsWith('/seats'))data=seats
   else if(r.method()==='GET' && path.includes('/classrooms/'))data=room
   else if(['POST','PATCH'].includes(r.method())){
    const body=r.postDataJSON();writes.push({path,body,method:r.method()})
    if(reject)return route.fulfill({status:409,json:{code:'RESOURCE_CONFLICT',message:'座位编号重复'}})
    if(path.includes('/classrooms')){room={...room,...body};data=room}
    else {const s={id:'9007199254740994',status:'AVAILABLE',...body};seats=[s];data=s}
   }else throw Error('Unexpected '+path)
   await route.fulfill({json:{code:'OK',data}})
  })
  await page.goto('http://127.0.0.1:15175/resource-admin')
  if(mode==='student'){
   await page.getByText('当前账号没有资源管理权限，或尚未绑定学院。请联系系统管理员。').waitFor()
   assert.equal(await page.getByRole('button',{name:'新增教室',exact:true}).count(),0)
   assert.equal(queries.length,0)
  }else{
   await page.getByRole('button',{name:'新增教室',exact:true}).click()
   const editor=page.locator('.editor')
   if(mode==='college'){assert.equal(queries[0].get('college_id'),'1');assert.equal(await editor.locator('select').filter({has:page.locator('option[value="1"]')}).isDisabled(),true)}
   await editor.getByLabel('教学楼',{exact:true}).fill('新教学楼')
   await editor.getByLabel('房间号',{exact:true}).fill('201')
   await page.getByRole('button',{name:'保存教室',exact:true}).click()
   await page.getByText('教室已保存。座位需在“管理座位”中单独添加。').waitFor()
   assert.equal(writes[0].method,'POST');assert.equal('status' in writes[0].body,false);assert.equal(writes[0].body.open_time,'08:00:00')
   if(mode==='college')assert.equal(writes[0].body.college_id,'1')
   await page.getByRole('button',{name:'编辑教室',exact:true}).click()
   await editor.locator('select').filter({has:page.locator('option[value="MAINTENANCE"]')}).selectOption('MAINTENANCE')
   await page.getByRole('button',{name:'保存教室',exact:true}).click()
   await page.getByText('教室已保存。座位需在“管理座位”中单独添加。').waitFor()
   assert.equal(writes[1].body.status,'MAINTENANCE')
   assert.ok(writes[1].path.endsWith('9007199254740993'))
   await page.getByRole('button',{name:'管理座位',exact:true}).click()
   await page.getByRole('button',{name:'新增座位',exact:true}).click()
   await editor.getByLabel('座位编号',{exact:true}).fill('A01')
   await editor.getByLabel('插座类型').selectOption('FIXED')
   await page.getByRole('button',{name:'保存座位',exact:true}).click()
   await page.getByText('座位已保存。',{exact:true}).waitFor()
   assert.equal(writes[2].body.classroom_id,'9007199254740993');assert.equal('status' in writes[2].body,false)
   await page.getByRole('button',{name:'编辑座位',exact:true}).click()
   await editor.getByLabel('座位状态').selectOption('DISABLED')
   await page.getByRole('button',{name:'保存座位',exact:true}).click()
   await page.getByText('座位已保存。',{exact:true}).waitFor()
   assert.equal(writes[3].body.status,'DISABLED');assert.equal('classroom_id' in writes[3].body,false)
   reject=true
   await page.getByRole('button',{name:'新增座位',exact:true}).click()
   await editor.getByLabel('座位编号',{exact:true}).fill('A01')
   await page.getByRole('button',{name:'保存座位',exact:true}).click()
   await page.getByRole('alert').filter({hasText:'座位编号重复'}).waitFor()
   assert.equal(await page.getByText('座位已保存。',{exact:true}).count(),0)
   if(mode==='system')await page.screenshot({path:'/tmp/resource-admin-desktop.png',fullPage:true})
   await page.setViewportSize({width:390,height:844})
   await page.waitForTimeout(150); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  }
  assert.deepEqual(errors,[]);console.log('PASS resource UI:',mode)
  await page.close()
 }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
