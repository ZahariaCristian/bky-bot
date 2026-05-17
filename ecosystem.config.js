module.exports = {
  apps : [{
    name: 'bky_bot',
    script: 'index.js',
    watch: false,
    autorestart: true,
    max_restarts: 1000,
    restart_delay: 500
  }]
};