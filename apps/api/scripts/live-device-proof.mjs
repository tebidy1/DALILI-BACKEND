// DTOP-02/03 برهان حيّ: اقتران حقيقي ← Bearer ← رفع بعدم تكرار ← (بعد الإبطال من الإعداد) 401
// الاستعمال:  node apps/api/scripts/live-device-proof.mjs            (اقتران + رفع)
//             node apps/api/scripts/live-device-proof.mjs --check <token>   (بعد الإبطال: يتوقّع 401)
const API = process.env.ITQAN_API ?? 'http://localhost:8787'
const WEB = process.env.ITQAN_WEB ?? 'http://localhost:5174'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function json(method, path, body, headers = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

if (process.argv[2] === '--check') {
  const me = await json('GET', '/api/auth/me', null, { authorization: `Bearer ${process.argv[3]}` })
  console.log(`check after revoke: status=${me.status} (expected 401)`)
  process.exit(me.status === 401 ? 0 : 1)
}

const start = await json('POST', '/api/device/start', { deviceName: 'live-proof' })
console.log(`1) start: status=${start.status} userCode=${start.body.userCode}`)
console.log(`   افتح في المتصفّح: ${WEB}/device?code=${start.body.userCode}`)

let token = null
for (let i = 0; i < 200 && !token; i++) {
  const r = await json('POST', '/api/device/token', { deviceCode: start.body.deviceCode })
  if (r.status === 200) token = r.body
  else if (r.status !== 428) {
    console.log(`   token: status=${r.status} ${r.body?.error}`)
    process.exit(1)
  } else await sleep(start.body.interval * 1000)
}
console.log(`2) token: deviceId=${token.deviceId} prefix=${token.token.slice(0, 4)}`)

const bearer = { authorization: `Bearer ${token.token}` }
const me = await json('GET', '/api/auth/me', null, bearer)
console.log(`3) me via Bearer: status=${me.status}`)

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.alloc(64)])
async function upload(key) {
  const fd = new FormData()
  fd.append('file', new Blob([jpeg], { type: 'image/jpeg' }), 'shot.jpg')
  const res = await fetch(`${API}/api/uploads`, { method: 'POST', headers: { ...bearer, 'idempotency-key': key }, body: fd })
  return { status: res.status, body: await res.json() }
}
const key = `live-proof-${Date.now()}`
const a = await upload(key)
const b = await upload(key)
console.log(`4) upload x2 same key: ${a.status}/${b.status} sameFile=${a.body.fileId === b.body.fileId}`)
console.log(`5) الآن ألغِ ربط «live-proof» من ${WEB}/settings ثم شغّل:`)
console.log(`   node apps/api/scripts/live-device-proof.mjs --check ${token.token}`)
