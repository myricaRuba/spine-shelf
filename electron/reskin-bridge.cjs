const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');

async function startReskinBridge({ service, userData, enqueue }) {
  const token = randomBytes(32).toString('hex');
  const descriptor = path.join(userData, 'spine-shelf-mcp.json');
  let lastConnectedAt = null;
  const handlers = {
    status: () => ({ app: 'Spine Shelf', assets: service.library.data.assets.length, pending: service.jobs.filter(j => ['queued','processing'].includes(j.status)).length }),
    list_tasks: args => ({ tasks: service.list(args).filter(j=>!args.taskId || j.id===args.taskId) }),
    get_task: args => service.context(args.taskId),
    create_task: args => service.create(args),
    update_task: args => service.update(args.taskId, args.status, args.message),
    apply: args => service.apply(args.taskId),
    read_image: args => service.image(args.taskId, args.area, args.file),
  };
  const server = http.createServer(async (req, res) => {
    const reply = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
    const expected = Buffer.from(token);
    if (req.headers.origin || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply(403, { error: '本地连接校验失败。' });
    if (req.method !== 'POST' || req.url !== '/call') return reply(404, { error: '接口不存在。' });
    try {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 64000) { reply(413, { error: '请求过大。' }); return; } }
      const { method, args = {} } = JSON.parse(body);
      if (!Object.hasOwn(handlers, method)) return reply(400, { error: '未知操作。' });
      lastConnectedAt = new Date().toISOString();
      const result = await enqueue(() => {
        if(args.runId) {
          const job=service.task(args.taskId);
          if(job.execution?.runId!==args.runId || job.execution.state!=='running') throw new Error('这次制作已停止或被重试任务替代。');
        }
        return handlers[method](args);
      });
      reply(200, { result });
    } catch (e) { reply(400, { error: e.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const info = { url: `http://127.0.0.1:${server.address().port}/call`, token, pid: process.pid };
  await fs.writeFile(descriptor, JSON.stringify(info), { mode: 0o600 });
  return {
    status: () => ({ available: true, lastConnectedAt }),
    close: async () => {
      server.closeAllConnections(); server.close();
      try { const current = JSON.parse(await fs.readFile(descriptor, 'utf8')); if (current.token === token) await fs.unlink(descriptor); } catch { /* Already removed. */ }
    },
  };
}
module.exports = { startReskinBridge };
