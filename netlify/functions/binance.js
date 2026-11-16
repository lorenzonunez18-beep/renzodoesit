// RENZO'S LAB V15: read-only public market metrics. Never substitutes venue identities.
const H={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'};
const periods=new Set(['5m','15m','1h','4h']);
async function get(url){const r=await fetch(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(5500)});if(!r.ok)throw Error('HTTP '+r.status);const j=await r.json();if(j?.retCode!==undefined&&j.retCode!==0)throw Error('Bybit '+j.retCode);if(j?.code!==undefined&&Number(j.code)<0)throw Error('Exchange '+j.code);return j}
exports.handler=async(event)=>{
 const symbol=String(event.queryStringParameters?.symbol||'BTCUSDT').toUpperCase(),period=String(event.queryStringParameters?.period||'5m');
 if(!/^[A-Z0-9]{3,24}$/.test(symbol)||!periods.has(period))return {statusCode:400,headers:H,body:JSON.stringify({error:'Invalid symbol or period'})};
 const paths={global:`/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=1`,topPositions:`/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=${period}&limit=1`,taker:`/futures/data/takerlongshortRatio?symbol=${symbol}&period=${period}&limit=1`,openInterest:`/fapi/v1/openInterest?symbol=${symbol}`,premium:`/fapi/v1/premiumIndex?symbol=${symbol}`};
 const stats={},errors=[],sources={};
 await Promise.all(Object.entries(paths).map(async([name,path])=>{try{const j=await get('https://fapi.binance.com'+path),v=Array.isArray(j)?j.at(-1):j;if(!v||typeof v!=='object')throw Error('Invalid data');stats[name]=v;sources[name]='Binance USD-M'}catch(e){stats[name]=null;errors.push({name,source:'Binance',message:String(e.message).slice(0,100)})}}));
 // Bybit fallback only for equivalent published public metrics. No fabricated taker/top trader positions.
 const bybitPeriod={'5m':'5min','15m':'15min','1h':'1h','4h':'4h'}[period];
 const jobs=[];
 if(!stats.global)jobs.push((async()=>{try{const j=await get(`https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${symbol}&period=${bybitPeriod}&limit=1`),v=j.result?.list?.[0];if(!v||!(+v.buyRatio>=0)||!(+v.sellRatio>=0)||!(+v.timestamp>0))throw Error('Missing ratio');stats.global={symbol,timestamp:+v.timestamp,longAccount:String(v.buyRatio),shortAccount:String(v.sellRatio)};sources.global='Bybit linear account ratio'}catch(e){errors.push({name:'global',source:'Bybit',message:String(e.message).slice(0,100)})}})());
 if(!stats.openInterest||!stats.premium)jobs.push((async()=>{try{const j=await get(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`),v=j.result?.list?.[0];if(!v||!(+v.markPrice>0))throw Error('Missing ticker');const now=Date.now();if(!stats.openInterest&&+v.openInterest>0){stats.openInterest={symbol,openInterest:String(v.openInterest),time:now};sources.openInterest='Bybit linear open interest'}if(!stats.premium){stats.premium={symbol,markPrice:String(v.markPrice),lastFundingRate:String(v.fundingRate||''),time:now,fundingIntervalHours:null};sources.premium='Bybit linear ticker / funding'}}catch(e){errors.push({name:'ticker',source:'Bybit',message:String(e.message).slice(0,100)})}})());
 await Promise.all(jobs);
 const available=Object.keys(sources),any=available.length>0;
 return {statusCode:any?200:503,headers:H,body:JSON.stringify({stats,errors,sources,source:available.length?[...new Set(Object.values(sources))].join(' + '):'No reachable futures provider',fetchedAt:Date.now(),diagnostics:{status:any?'PARTIAL_OR_OK':'UNAVAILABLE',message:any?'Metrics are labeled by venue. Unavailable metrics remain blank. Bybit is not Binance; reports may differ.':'Binance and Bybit public endpoints unavailable from this deployment.'}})};
};
