// NMRE service worker build 20261127-subito-browser-importer-1
self.addEventListener("install",event=>{self.skipWaiting();});
self.addEventListener("activate",event=>{event.waitUntil(self.clients.claim());});
self.addEventListener("push",event=>{
  let data={title:"Nicholas Magi Real Estate",body:"Ha un nuovo aggiornamento.",url:"/"};
  try{if(event.data)data={...data,...event.data.json()};}catch(_){}
  event.waitUntil(self.registration.showNotification(data.title,{
    body:data.body||"",
    icon:"./icon.svg",
    badge:"./icon.svg",
    tag:data.notificationId||"nmre-update",
    requireInteraction:true,
    silent:false,
    renotify:true,
    data:{url:data.url||"/"}
  }));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const raw=event.notification.data&&event.notification.data.url||"/";
  const target=new URL(raw,self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    for(const client of list){if(client.url.startsWith(self.registration.scope)&&"focus" in client){client.navigate(target);return client.focus();}}
    return self.clients.openWindow?self.clients.openWindow(target):undefined;
  }));
});
