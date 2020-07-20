const createError = require('http-errors');
const compression = require('compression');
const childProcess = require('child_process');
const nodeCleanup = require('node-cleanup');
const express = require('express');
const session = require('express-session');
const path = require('path');
const cookieParser = require('cookie-parser');
const nconf = require('nconf');
const logger = require('morgan');

// Getting config values from config.json
nconf
 .env()
 .argv()
 .file(path.join(__dirname, 'configs', 'config.json'));

const isDev = nconf.get('NODE_ENV') === 'DEV';
const isNginx = nconf.get('ENABLE_NGINX') === true;
const isRedis = nconf.get('ENABLE_REDIS') === true;
let redis = null;

if (isRedis) {
 const Redis = require('ioredis');
 const redisPort = nconf.get('REDIS_PORT') || 9000;
 redis = new Redis(redisPort); 
 
 // Testing redis
 redis.set('redis:started', true);
 redis.get('redis:started', (err, result) => {
  if (err) {
   console.error('Redis: error = ', err); 
  } else {
   console.log('Redis: connected = ', result);
  }
 });
}

if (isNginx) {
 const nginxCustomPath = nconf.get('NGINX_PATH');
 const nginx = nginxCustomPath || '/usr/local/bin/nginx';
 const nginxConfPath = nconf.get('NGINX_CONF_PATH') || path.join(__dirname, 'configs', 'nginx.conf');

 const ng = childProcess.spawn(nginx, ['-c', nginxConfPath]);

 ng.stdout.on('data', (data) => {
  console.log('stdout: ', data);
 });

 ng.stderr.on('data', (data) => {
  console.log('stderr: ', Buffer.from(data).toString('utf8'));
 });

 ng.on('close', (code) => {
  console.log('close: ', code);
 });

 // Clean up nginx on exit
 nodeCleanup((code, signal) => {
  if (ng !== null) {
   childProcess.exec(`${nginx} -s stop`, (error, stdout, stderr) => {
    if (error) {
     console.error(`Error stopping nginx: ${error}`);
     return;
    }
    console.log(`stdout: ${stdout}`);
    console.error(`stderr: ${stderr}`);
   });
  }
 });
}

// Customized router
const indexRouter = require('./routes/index');
const usersRouter = require('./routes/users');

const app = express();

// View engine setup (using 'pug' as default)
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

// Session setup based on NODE_ENV
let sessionOptions;

if (isDev) {
 sessionOptions = {
  secret: nconf.get('session-secret'),
  store: new session.MemoryStore(),
  cookie: { secure: false },
  resave: true,
  saveUninitialized: true  
 };
} else {
 // PROD, more secured session configuration
 // https://expressjs.com/en/advanced/best-practice-security.html#use-cookies-securely
 sessionOptions = { 
  secret: nconf.get('session-secret'), // replace with redis secret
  store: new session.MemoryStore(), // replace with redis
  cookie: {
   secure: true,
   httpOnly: true,
   domain: nconf.get('domain'),
   path: nconf.get('session-path'),
   expires: new Date(Date.now() + 3600 * 1000) // 1 hour
  },
  resave: true,
  saveUninitialized: true
 };
}

if (!isDev) {
 // Protecting the app from well-known web vulnerabilities
 // https://expressjs.com/en/advanced/best-practice-security.html#use-helmet
 const helmet = require('helmet');
 app.use(helmet());
}

// Compress response body
// https://expressjs.com/en/advanced/best-practice-performance.html#use-gzip-compression
app.use(compression());

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session(sessionOptions));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
