module.exports = {
  apps: [
    {
      name: "aria-wabot",
      script: "src/index.js",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
        BASE_URL: "https://aria-dashboard.ngrok-free.dev"
      }
    },
    {
      name: "aria-tunnel",
      script: "ngrok",
      args: "http 3001 --domain=aria-dashboard.ngrok-free.dev",
      autorestart: true,
      max_restarts: 10
    }
  ]
};
