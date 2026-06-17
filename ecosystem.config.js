module.exports = {
  apps: [{
    name: 'tiktok-gift-jar',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env_production: {
      NODE_ENV: 'production',
    },
  }],
};