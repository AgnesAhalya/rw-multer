'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const multer = require('./index');

const app = express();

const PORT = parsePort(process.env.PORT, 3000);
const HOST = process.env.HOST || '0.0.0.0';
const UPLOAD_DIRECTORY = path.resolve(
  process.env.UPLOAD_DIRECTORY || path.join(__dirname, 'uploads')
);

const MAX_DISK_FILE_SIZE = 5 * 1024 * 1024;
const MAX_MEMORY_FILE_SIZE = 2 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'text/plain'
]);

ensureUploadDirectory(UPLOAD_DIRECTORY);

app.disable('x-powered-by');

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({
  extended: false,
  limit: '100kb'
}));

const diskStorage = multer.diskStorage({
  destination(req, file, callback) {
    callback(null, UPLOAD_DIRECTORY);
  },

  filename(req, file, callback) {
    try {
      const extension = sanitiseExtension(
        path.extname(file.originalname || '')
      );

      const generatedName =
        `${Date.now()}-${crypto.randomUUID()}${extension}`;

      callback(null, generatedName);
    } catch (error) {
      callback(error);
    }
  }
});

const diskUpload = multer({
  storage: diskStorage,

  limits: {
    fileSize: MAX_DISK_FILE_SIZE,
    files: 20,
    fields: 100,
    parts: 120,
    fieldNameSize: 200
  },

  fileFilter(req, file, callback) {
    if (!file || typeof file.mimetype !== 'string') {
      return callback(
        createHttpError(400, 'Invalid uploaded file metadata')
      );
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return callback(
        createHttpError(
          415,
          `Unsupported file type: ${file.mimetype}`
        )
      );
    }

    callback(null, true);
  }
});

const memoryUpload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_MEMORY_FILE_SIZE,
    files: 5,
    fields: 50,
    parts: 55,
    fieldNameSize: 200
  },

  fileFilter(req, file, callback) {
    if (!file || !ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return callback(
        createHttpError(415, 'Unsupported file type')
      );
    }

    callback(null, true);
  }
});

app.get('/health', function healthRoute(req, res) {
  res.status(200).json({
    status: 'ok',
    service: 'upload-test-service',
    timestamp: new Date().toISOString()
  });
});

app.get('/', function indexRoute(req, res) {
  res.status(200).json({
    service: 'Upload test application',
    routes: [
      {
        method: 'POST',
        path: '/upload/single',
        fileField: 'avatar'
      },
      {
        method: 'POST',
        path: '/upload/array',
        fileField: 'documents'
      },
      {
        method: 'POST',
        path: '/upload/fields',
        fileFields: ['avatar', 'gallery']
      },
      {
        method: 'POST',
        path: '/upload/any'
      },
      {
        method: 'POST',
        path: '/upload/text'
      },
      {
        method: 'POST',
        path: '/upload/memory',
        fileField: 'file'
      },
      {
        method: 'POST',
        path: '/form/fields'
      },
      {
        method: 'POST',
        path: '/form/batch',
        fileField: 'attachments'
      }
    ]
  });
});

app.post(
  '/upload/single',
  diskUpload.single('avatar'),
  asyncRoute(async function singleUploadRoute(req, res) {
    if (!req.file) {
      throw createHttpError(
        400,
        'A file is required in the "avatar" field'
      );
    }

    res.status(201).json({
      success: true,
      body: req.body,
      file: serialiseDiskFile(req.file)
    });
  })
);

app.post(
  '/upload/array',
  diskUpload.array('documents', 10),
  asyncRoute(async function arrayUploadRoute(req, res) {
    const files = Array.isArray(req.files)
      ? req.files
      : [];

    if (files.length === 0) {
      throw createHttpError(
        400,
        'At least one file is required in the "documents" field'
      );
    }

    res.status(201).json({
      success: true,
      body: req.body,
      fileCount: files.length,
      files: files.map(serialiseDiskFile)
    });
  })
);

app.post(
  '/upload/fields',
  diskUpload.fields([
    {
      name: 'avatar',
      maxCount: 1
    },
    {
      name: 'gallery',
      maxCount: 5
    }
  ]),
  asyncRoute(async function fieldsUploadRoute(req, res) {
    const files = req.files || {};
    const avatar = Array.isArray(files.avatar)
      ? files.avatar
      : [];
    const gallery = Array.isArray(files.gallery)
      ? files.gallery
      : [];

    if (avatar.length === 0 && gallery.length === 0) {
      throw createHttpError(
        400,
        'An avatar or gallery file is required'
      );
    }

    res.status(201).json({
      success: true,
      body: req.body,
      files: {
        avatar: avatar.map(serialiseDiskFile),
        gallery: gallery.map(serialiseDiskFile)
      }
    });
  })
);

app.post(
  '/upload/any',
  diskUpload.any(),
  asyncRoute(async function anyUploadRoute(req, res) {
    const files = Array.isArray(req.files)
      ? req.files
      : [];

    if (files.length === 0) {
      throw createHttpError(
        400,
        'At least one uploaded file is required'
      );
    }

    res.status(201).json({
      success: true,
      body: req.body,
      fileCount: files.length,
      files: files.map(serialiseDiskFile)
    });
  })
);

app.post(
  '/upload/text',
  diskUpload.none(),
  asyncRoute(async function textOnlyRoute(req, res) {
    if (
      !req.body ||
      Object.keys(req.body).length === 0
    ) {
      throw createHttpError(
        400,
        'At least one multipart text field is required'
      );
    }

    res.status(200).json({
      success: true,
      body: req.body
    });
  })
);

app.post(
  '/upload/memory',
  memoryUpload.single('file'),
  asyncRoute(async function memoryUploadRoute(req, res) {
    if (!req.file) {
      throw createHttpError(
        400,
        'A file is required in the "file" field'
      );
    }

    res.status(201).json({
      success: true,
      body: req.body,
      file: {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        encoding: req.file.encoding,
        mimetype: req.file.mimetype,
        size: req.file.size,
        bufferLength: Buffer.isBuffer(req.file.buffer)
          ? req.file.buffer.length
          : 0
      }
    });
  })
);

app.use(
  '/form/fields',
  exactPostOnly,
  diskUpload.none(),
  asyncRoute(async function formFieldsRoute(req, res) {
    if (
      !req.body ||
      Object.keys(req.body).length === 0
    ) {
      throw createHttpError(
        400,
        'At least one multipart text field is required'
      );
    }

    res.status(200).json({
      success: true,
      body: req.body
    });
  })
);

app.use(
  '/form/batch',
  exactPostOnly,
  diskUpload.array('attachments', 2),
  asyncRoute(async function formBatchRoute(req, res) {
    const files = Array.isArray(req.files)
      ? req.files
      : [];

    if (files.length === 0) {
      throw createHttpError(
        400,
        'At least one file is required in the "attachments" field'
      );
    }

    res.status(201).json({
      success: true,
      body: req.body,
      fileCount: files.length,
      files: files.map(serialiseDiskFile)
    });
  })
);

app.use(function routeNotFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `No route matches ${req.method} ${req.originalUrl}`
    }
  });
});

app.use(async function globalErrorHandler(
  error,
  req,
  res,
  next
) {
  if (res.headersSent) {
    return next(error);
  }

  await removeRequestFiles(req);

  if (error instanceof multer.MulterError) {
    return res.status(multerStatusCode(error)).json({
      success: false,
      error: {
        type: 'MulterError',
        code: error.code,
        message: error.message,
        field: error.field || null,
        storageErrors: Array.isArray(error.storageErrors)
          ? error.storageErrors.map(normaliseStorageError)
          : []
      }
    });
  }

  const statusCode = isValidStatusCode(error.statusCode)
    ? error.statusCode
    : 500;

  if (statusCode >= 500) {
    console.error('Unhandled request error:', error);
  }

  res.status(statusCode).json({
    success: false,
    error: {
      type: error.name || 'Error',
      code: error.code || 'REQUEST_FAILED',
      message: statusCode >= 500
        ? 'The request could not be completed'
        : error.message
    }
  });
});

const server = app.listen(PORT, HOST, function onStarted() {
  console.log(
    `Upload test service listening at http://${HOST}:${PORT}`
  );
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;

let shutdownStarted = false;

function shutdown(signal) {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  console.log(`${signal} received. Closing server.`);

  const forceShutdownTimer = setTimeout(function forceShutdown() {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);

  forceShutdownTimer.unref();

  server.close(function onClosed(error) {
    clearTimeout(forceShutdownTimer);

    if (error) {
      console.error('Server shutdown failed:', error);
      process.exitCode = 1;
      return;
    }

    console.log('Server closed cleanly');
    process.exitCode = 0;
  });
}

process.on('SIGINT', function onSigint() {
  shutdown('SIGINT');
});

process.on('SIGTERM', function onSigterm() {
  shutdown('SIGTERM');
});

process.on('uncaughtException', function onUncaughtException(error) {
  console.error('Uncaught exception:', error);
  shutdown('uncaughtException');
});

process.on(
  'unhandledRejection',
  function onUnhandledRejection(reason) {
    console.error('Unhandled promise rejection:', reason);
    shutdown('unhandledRejection');
  }
);

function exactPostOnly(req, res, next) {
  if (req.path !== '/' && req.path !== '') {
    return res.status(404).json({
      success: false,
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `No route matches ${req.method} ${req.originalUrl}`
      }
    });
  }

  if (req.method !== 'POST') {
    res.set('Allow', 'POST');

    return res.status(405).json({
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Only POST is allowed for this endpoint'
      }
    });
  }

  next();
}

function asyncRoute(handler) {
  return function wrappedRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function createHttpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code || 'INVALID_REQUEST';
  return error;
}

function parsePort(value, fallback) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1 ||
    parsed > 65535
  ) {
    return fallback;
  }

  return parsed;
}

function ensureUploadDirectory(directory) {
  try {
    fs.mkdirSync(directory, {
      recursive: true,
      mode: 0o750
    });

    fs.accessSync(
      directory,
      fs.constants.R_OK | fs.constants.W_OK
    );
  } catch (error) {
    console.error(
      `Upload directory is unavailable: ${directory}`,
      error
    );

    process.exit(1);
  }
}

function sanitiseExtension(extension) {
  if (!extension) {
    return '';
  }

  const normalised = extension
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, '')
    .slice(0, 10);

  if (
    normalised === '.' ||
    !normalised.startsWith('.')
  ) {
    return '';
  }

  return normalised;
}

function serialiseDiskFile(file) {
  return {
    fieldname: file.fieldname,
    originalname: file.originalname,
    encoding: file.encoding,
    mimetype: file.mimetype,
    destination: file.destination,
    filename: file.filename,
    path: file.path,
    size: file.size
  };
}

function multerStatusCode(error) {
  switch (error.code) {
    case 'LIMIT_FILE_SIZE':
    case 'LIMIT_FIELD_VALUE':
    case 'LIMIT_PART_COUNT':
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_FIELD_COUNT':
      return 413;

    case 'LIMIT_UNEXPECTED_FILE':
    case 'LIMIT_FIELD_KEY':
    case 'MISSING_FIELD_NAME':
      return 400;

    default:
      return 400;
  }
}

function isValidStatusCode(value) {
  return Number.isInteger(value) &&
    value >= 400 &&
    value <= 599;
}

function normaliseStorageError(error) {
  return {
    message: error && error.message
      ? error.message
      : 'Storage cleanup failed',

    field: error &&
      error.file &&
      error.file.fieldname
      ? error.file.fieldname
      : null
  };
}

async function removeRequestFiles(req) {
  const files = collectDiskFiles(req);

  await Promise.allSettled(
    files.map(function removeFile(file) {
      return fs.promises.unlink(file.path);
    })
  );
}

function collectDiskFiles(req) {
  const files = [];

  if (req.file && isDiskFile(req.file)) {
    files.push(req.file);
  }

  if (Array.isArray(req.files)) {
    for (const file of req.files) {
      if (isDiskFile(file)) {
        files.push(file);
      }
    }
  } else if (
    req.files &&
    typeof req.files === 'object'
  ) {
    for (const value of Object.values(req.files)) {
      if (!Array.isArray(value)) {
        continue;
      }

      for (const file of value) {
        if (isDiskFile(file)) {
          files.push(file);
        }
      }
    }
  }

  return files;
}

function isDiskFile(file) {
  return Boolean(
    file &&
    typeof file.path === 'string' &&
    file.path.length > 0
  );
}

module.exports = {
  app,
  server
};

