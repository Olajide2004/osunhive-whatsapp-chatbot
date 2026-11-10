module.exports = {
    apps: [
        {
            name: 'osunhive-bot',
            script: 'index.js',
            cwd: __dirname + '/..',
            instances: 1,
            exec_mode: 'fork',
            autorestart: true,
            restart_delay: 5000,
            max_memory_restart: '450M',
            env: {
                NODE_ENV: 'production',
                BOT_PHONE_NUMBER: '<PHONE_NUMBER>'
            }
        }
    ]
};
