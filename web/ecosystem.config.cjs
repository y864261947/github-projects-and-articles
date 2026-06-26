module.exports = {
  apps: [
    {
      name: "github-projects-web",
      script: "server.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        PORT: "3027"
      }
    }
  ]
};

