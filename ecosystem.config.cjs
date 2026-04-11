module.exports = {
  apps: [
    {
      name: 'salesbrain',
      cwd: '/srv/salesbrain',
      script: 'npm',
      args: 'start -- -p 3002 -H 127.0.0.1',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      time: true
    }
  ]
};
