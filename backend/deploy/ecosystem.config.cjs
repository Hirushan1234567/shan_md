module.exports = {
  apps: [{
    name: "shan-api-hub-backend",
    script: "./server.js",
    cwd: "/opt/shan_md/backend",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    max_memory_restart: "450M",
    env: {
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: 3035
    },
    time: true
  }]
};
