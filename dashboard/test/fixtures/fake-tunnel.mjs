// Stands in for a tunnel tool in tests. FAKE_TUNNEL_MODE selects the output:
//   (unset)  cloudflared-style quick-tunnel line on stderr, then stays alive
//   ngrok    ngrok JSON log line on stdout, then stays alive
//   error    cloudflared-style error line naming api.trycloudflare.com, then exits 1
const mode = process.env.FAKE_TUNNEL_MODE;
if (mode === 'error') {
  setTimeout(() => {
    console.error('ERR Error unmarshaling QuickTunnel response: Post "https://api.trycloudflare.com/tunnel": EOF');
    process.exit(1);
  }, 300);
} else {
  setTimeout(() => {
    if (mode === 'ngrok') console.log('{"msg":"started tunnel","url":"https://x.ngrok-free.app"}');
    else console.error('INF |  https://fake-tunnel-123.trycloudflare.com  |');
  }, 300);
  setInterval(() => {}, 1000);
}
