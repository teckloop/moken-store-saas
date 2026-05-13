// PM2 ecosystem — production process manager
// Start: pm2 start deploy/ecosystem.config.cjs

module.exports = {
  apps: [
    {
      name: "moken-api",
      script: "apps/api/dist/server.js",
      cwd: "/var/www/moken",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PORT: "4100"
      },
      error_file: "/var/log/moken/api.error.log",
      out_file: "/var/log/moken/api.out.log",
      time: true
    }
  ]
};
