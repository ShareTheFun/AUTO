const fs = require('fs');
const path = require('path');
const login = require('ws3-fca'); // Replaced the fb-chat-api folder with ws3-fca package
const express = require('express');
const app = express();
const chalk = require('chalk');
const bodyParser = require('body-parser');
const script = path.join(__dirname, 'script');
const cron = require('node-cron');
const config = fs.existsSync('./data') && fs.existsSync('./data/config.json') 
    ? JSON.parse(fs.readFileSync('./data/config.json', 'utf8')) 
    : createConfig();

const Utils = {
  commands: new Map(),
  handleEvent: new Map(),
  account: new Map(),
  cooldowns: new Map(),
};

fs.readdirSync(script).forEach((file) => {
  const scripts = path.join(script, file);
  const stats = fs.statSync(scripts);

  if (stats.isDirectory()) {
    fs.readdirSync(scripts).forEach((file) => {
      try {
        const { config, run, handleEvent } = require(path.join(scripts, file));
        if (config) registerCommand(config, run, handleEvent);
      } catch (error) {
        console.error(chalk.red(`Error installing command from file ${file}: ${error.message}`));
      }
    });
  } else {
    try {
      const { config, run, handleEvent } = require(scripts);
      if (config) registerCommand(config, run, handleEvent);
    } catch (error) {
      console.error(chalk.red(`Error installing command from file ${file}: ${error.message}`));
    }
  }
});

function registerCommand(config, run, handleEvent) {
  const { 
    name = [], role = '0', version = '1.0.0', hasPrefix = true, 
    aliases = [], description = '', usage = '', credits = '', cooldown = '5' 
  } = Object.fromEntries(Object.entries(config).map(([key, value]) => [key.toLowerCase(), value]));

  aliases.push(name);

  if (run) {
    Utils.commands.set(aliases, {
      name,
      role,
      run,
      aliases,
      description,
      usage,
      version,
      hasPrefix,
      credits,
      cooldown
    });
  }

  if (handleEvent) {
    Utils.handleEvent.set(aliases, {
      name,
      handleEvent,
      role,
      description,
      usage,
      version,
      hasPrefix,
      credits,
      cooldown
    });
  }
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(express.json());

// Routes
const routes = [
  { path: '/', file: 'index.html' },
  { path: '/step_by_step_guide', file: 'guide.html' },
  { path: '/online_user', file: 'online.html' },
];

routes.forEach(route => {
  app.get(route.path, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', route.file));
  });
});

app.get('/info', (req, res) => {
  const data = Array.from(Utils.account.values()).map(account => ({
    name: account.name,
    profileUrl: account.profileUrl,
    thumbSrc: account.thumbSrc,
    time: account.time
  }));
  res.json(data);
});

app.get('/commands', (req, res) => {
  const commandSet = new Set();
  const commands = [...Utils.commands.values()].map(({ name }) => {
    commandSet.add(name);
    return name;
  });

  const handleEvent = [...Utils.handleEvent.values()]
    .map(({ name }) => commandSet.has(name) ? null : name)
    .filter(Boolean);

  const role = [...Utils.commands.values()].map(({ role }) => role);
  const aliases = [...Utils.commands.values()].map(({ aliases }) => aliases);

  res.json({
    commands,
    handleEvent,
    role,
    aliases
  });
});

app.post('/login', async (req, res) => {
  const { state, commands, prefix, admin } = req.body;

  if (!state) {
    return res.status(400).json({ error: true, message: 'Missing app state data' });
  }

  const cUser = state.find(item => item.key === 'c_user');

  if (cUser) {
    const existingUser = Utils.account.get(cUser.value);
    if (existingUser) {
      console.log(`User ${cUser.value} is already logged in`);
      return res.status(400).json({
        error: false,
        message: "Active user session detected; already logged in",
        user: existingUser
      });
    }

    try {
      await accountLogin(state, commands, prefix, [admin]);
      res.status(200).json({
        success: true,
        message: 'Authentication process completed successfully; login achieved.'
      });
    } catch (error) {
      console.error(error);
      res.status(400).json({ error: true, message: error.message });
    }
  } else {
    res.status(400).json({
      error: true,
      message: "There's an issue with the appstate data; it's invalid."
    });
  }
});

app.listen(3000, () => {
  console.log(`Server is running at http://localhost:5000`);
});

async function accountLogin(state, enableCommands = [], prefix, admin = []) {
  return new Promise((resolve, reject) => {
    login({ appState: state }, async (error, api) => {
      if (error) return reject(error);

      const userid = await api.getCurrentUserID();
      addThisUser(userid, enableCommands, state, prefix, admin);
      
      try {
        const userInfo = await api.getUserInfo(userid);
        const { name, profileUrl, thumbSrc } = userInfo[userid];
        Utils.account.set(userid, { name, profileUrl, thumbSrc, time: 0 });
      } catch (error) {
        reject(error);
      }
      
      resolve();
    });
  });
}

main();

function main() {
  if (!fs.existsSync('./data')) fs.mkdirSync('./data');
  if (!fs.existsSync('./data/config.json')) createConfig();

  console.log('Initialization complete.');
}

function createConfig() {
  const config = [{
    masterKey: { admin: [], restartTime: 15 },
    fcaOption: {
      forceLogin: true,
      listenEvents: true,
      logLevel: "silent",
      online: true,
    }
  }];
  fs.writeFileSync('./data/config.json', JSON.stringify(config, null, 2));
  return config;
}
