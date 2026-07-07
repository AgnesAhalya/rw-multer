
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const multer = require('./index');

const app = express();

const PORT = parsePort(process.env.PORT, 3000);
const HOST = process.env.HOST || '127.0.0.1';
const UPLOAD_DIRECTORY = path.resolve(
  process.env.UPLOAD_DIRECTORY || path.join(__dirname, 'uploads')
);

const MAX_DISK_FILE_SIZE = 5 * 1024 * 1024;
const MAX_MEMORY_FILE_SIZE = 2 * 1024 * 1024;

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png'
]);

ensureUploadDirectory(UPLOAD_DIRECTORY);

app.disable('x-powered-by');
app.set('case sensitive routing', true);
app.set('strict routing', true);

app.use(assignRequestId);
app.use(setSecurityHeaders);

app.use(express.json({
  limit: '100kb',
  strict: true,
  type: 'application/json'
}));

app.use(express.urlencoded({
  extended: false,
  limit: '100kb',
  parameterLimit: 50,
  type: 'application/x-www-form-urlencoded'
}));

const diskStorage = multer.diskStorage({
  destination(req, file, callback) {
    callback(null, UPLOAD_DIRECTORY);
  },

  filename(req, file, callback) {
    try {
      const extension = extensionForMimeType(file.mimetype);
      const generatedName = `${crypto.randomUUID()}${extension}`;

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
    if (
      !file ||
      typeof file.mimetype !== 'string' ||
      !ALLOWED_MIME_TYPES.has(file.mimetype)
    ) {
      return callback(
        createHttpError(
          415,
          'UNSUPPORTED_MEDIA_TYPE'
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
    if (
      !file ||
      typeof file.mimetype !== 'string' ||
      !ALLOWED_MIME_TYPES.has(file.mimetype)
    ) {
      return callback(
        createHttpError(
          415,
          'UNSUPPORTED_MEDIA_TYPE'
        )
      );
    }

    callback(null, true);
  }
});

app.get('/health', function healthRoute(req, res) {
  res.status(200).json({
    status: 'ok',
    requestId: req.requestId
  });
});

app.get('/', function indexRoute(req, res) {
  res.status(200).json({
    service: 'upload-service',
    requestId: req.requestId
  });
});

app.post(
  '/upload/single',
  requireMultipart,
  diskUpload.single('avatar'),
  asyncRoute(async function singleUploadRoute(req, res) {
    if (!req.file) {
      throw createHttpError(400, 'INVALID_REQUEST');
    }

    await validateDiskFiles([req.file]);

    res.status(201).json({
      success: true,
      requestId: req.requestId,
      file: serialiseFile(req.file)
    });
  })
);

app.post(
  '/upload/array',
  requireMultipart,
  diskUpload.array('documents', 10),
  asyncRoute(async function arrayUploadRoute(req, res) {
    const files = asFileArray(req.files);

    if (files.length === 0) {
      throw createHttpError(400, 'INVALID_REQUEST');
    }

    await validateDiskFiles(files);

    res.status(201).json({
      success: true,
      requestId: req.requestId,
      fileCount: files.length,
      files: files.map(serialiseFile)
    });
  })
);

app.post(
  '/upload/fields',
  requireMultipart,
  diskUpload.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'gallery', maxCount: 5 }
  ]),
  asyncRoute(async function fieldsUploadRoute(req, res) {
    const files = collectFilesFromRequest(req);

    if (files.length === 0) {
      throw createHttpError(400, 'INVALID_REQUEST');
    }

    await validateDiskFiles(files);

    res.status(201).json({
      success: true,
      requestId: req.requestId,
      fileCount: files.length,
      files: files.map(serialiseFile)
    });
  })
);

app.post(
  '/upload/any',
  requireMultipart,
  diskUpload.any(),
  asyncRoute(async function anyUploadRoute(req, res) {
    const files = asFileArray(req.files);

    if (files.length === 0) {
      throw createHttpError(400, 'INVALID_REQUEST');
    }

    await validateDiskFiles(files);

    res.status(201).json({
      success: true,
      requestId: req.requestId,
      fileCount: files.length,
      files: files.map(serialiseFile)
    });
  })
);

app.post(
  '/upload/text',
  requireMultipart,
  diskUpload.none(),
  asyncRoute(async function textOnlyRoute(req, res) {
    const fieldCount = countTopLevelFields(req.body);

    if (fieldCount === 0) {
      throw createHttpError(400, 'INVALID_REQUEST');
    }

    res.status(200).json({
      success: true,
      requestId: req.requestId,
      fieldCount
    });
  })
);

app.post(
  '/upload/memory',
  requireMultipart,
  memoryUpload.single('file'),
  asyncRoute(async function memoryUploadRoute(req, res) {
    if (
      !req.file ||
      !Buffer.isBuffer(req.file.buffer)
    ) {
      throw createHttpError(400, 'INVALID_REQUEST');
    }

    validateBufferType(
      req.file.buffer,
      req.file.mimetype
    );

    res.status(201).json({
      success: true,
      requestId: req.requestId,
      file: serialiseFile(req.file)
    });
  })
);

app.use(
  '/form/fields',
  exactPostOnly('/form/fields'),
  requireMultipart,
  diskUpload.none(),
  asyncRoute(async function formFieldsRoute(req, res) {
    const fieldCount = countTopLevelFields(req.body);

    if (fieldCount === 0) {
      throw createHttpError(400, 'INVALID_REQUEST');
    }

    res.status(200).json({
      success: true,
      requestId: req.requestId,
      fieldCount
    });
  })
);

app.use(
  '/form/batch',
  exactPostOnly('/form/batch'),
  requireMultipart,
  diskUpload.array('attachments', 2),
  asyncRoute(async function formBatchRoute(req, res) {
    const files = asFileArray(req.files);

    if (files.length === 0) {
      throw createHttpError(400, 'INVALID_REQUEST');
    }

    await validateDiskFiles(files);

    res.status(201).json({
      success: true,
      requestId: req.requestId,
      fileCount: files.length,
      files: files.map(serialiseFile)
    });
  })
);

app.use(function routeNotFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    requestId: req.requestId,
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found'
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

  const response = publicErrorResponse(error);

  if (response.statusCode >= 500) {
    logInternalError(error, req);
  }

  res.status(response.statusCode).json({
    success: false,
    requestId: req.requestId,
    error: {
      code: response.code,
      message: response.message
    }
  });
});

const server = app.listen(PORT, HOST, function onStarted() {
  console.log(`Upload service listening on ${HOST}:${PORT}`);
});

server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

let shutdownStarted = false;

function shutdown(signal) {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  console.log(`Shutdown requested: ${signal}`);

  const forceShutdownTimer = setTimeout(function forceShutdown() {
    process.exit(1);
  }, 10_000);

  forceShutdownTimer.unref();

  server.close(function onClosed(error) {
    clearTimeout(forceShutdownTimer);

    if (error) {
      console.error('Server shutdown failed');
      process.exitCode = 1;
      return;
    }

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
  console.error('Uncaught exception');
  console.error(error);
  shutdown('uncaughtException');
});

process.on(
  'unhandledRejection',
  function onUnhandledRejection(reason) {
    console.error('Unhandled promise rejection');
    console.error(reason);
    shutdown('unhandledRejection');
  }
);

function assignRequestId(req, res, next) {
  const requestId = crypto.randomUUID();

  Object.defineProperty(req, 'requestId', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: requestId
  });

  res.setHeader('X-Request-Id', requestId);
  next();
}

function setSecurityHeaders(req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(), camera=()'
  );

  next();
}

function requireMultipart(req, res, next) {
  if (!req.is('multipart/form-data')) {
    return next(
      createHttpError(
        415,
        'UNSUPPORTED_MEDIA_TYPE'
      )
    );
  }

  next();
}

function exactPostOnly(expectedPath) {
  return function exactPostOnlyMiddleware(req, res, next) {
    const rawPath = getRawPath(req.originalUrl);

    if (rawPath !== expectedPath) {
      return res.status(404).json({
        success: false,
        requestId: req.requestId,
        error: {
          code: 'NOT_FOUND',
          message: 'The requested resource was not found'
        }
      });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');

      return res.status(405).json({
        success: false,
        requestId: req.requestId,
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'The request method is not allowed'
        }
      });
    }

    next();
  };
}

function getRawPath(originalUrl) {
  const queryIndex = originalUrl.indexOf('?');

  return queryIndex === -1
    ? originalUrl
    : originalUrl.slice(0, queryIndex);
}

function asyncRoute(handler) {
  return function wrappedRoute(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function createHttpError(statusCode, code) {
  const error = new Error(code);
  error.statusCode = statusCode;
  error.publicCode = code;

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
    console.error('Upload directory is unavailable');
    process.exit(1);
  }
}

function extensionForMimeType(mimeType) {
  switch (mimeType) {
    case 'application/pdf':
      return '.pdf';

    case 'image/jpeg':
      return '.jpg';

    case 'image/png':
      return '.png';

    default:
      throw createHttpError(
        415,
        'UNSUPPORTED_MEDIA_TYPE'
      );
  }
}

function serialiseFile(file) {
  return {
    mimetype: file.mimetype,
    size: file.size
  };
}

function countTopLevelFields(body) {
  if (
    !body ||
    typeof body !== 'object'
  ) {
    return 0;
  }

  return Object.keys(body).length;
}

function asFileArray(value) {
  return Array.isArray(value)
    ? value
    : [];
}

function collectFilesFromRequest(req) {
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

    return files;
  }

  if (
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

async function validateDiskFiles(files) {
  try {
    for (const file of files) {
      const handle = await fs.promises.open(
        file.path,
        'r'
      );

      try {
        const probe = Buffer.alloc(16);
        const result = await handle.read(
          probe,
          0,
          probe.length,
          0
        );

        validateBufferType(
          probe.subarray(0, result.bytesRead),
          file.mimetype
        );
      } finally {
        await handle.close();
      }
    }
  } catch (error) {
    throw createHttpError(
      415,
      'UNSUPPORTED_MEDIA_TYPE'
    );
  }
}

function validateBufferType(buffer, mimeType) {
  const valid = (
    mimeType === 'application/pdf' &&
    startsWithBytes(
      buffer,
      [0x25, 0x50, 0x44, 0x46, 0x2d]
    )
  ) || (
    mimeType === 'image/jpeg' &&
    startsWithBytes(
      buffer,
      [0xff, 0xd8, 0xff]
    )
  ) || (
    mimeType === 'image/png' &&
    startsWithBytes(
      buffer,
      [
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a
      ]
    )
  );

  if (!valid) {
    throw createHttpError(
      415,
      'UNSUPPORTED_MEDIA_TYPE'
    );
  }
}

function startsWithBytes(buffer, bytes) {
  if (
    !Buffer.isBuffer(buffer) ||
    buffer.length < bytes.length
  ) {
    return false;
  }

  return bytes.every(function matches(value, index) {
    return buffer[index] === value;
  });
}

function publicErrorResponse(error) {
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
      case 'LIMIT_FIELD_VALUE':
      case 'LIMIT_PART_COUNT':
      case 'LIMIT_FILE_COUNT':
      case 'LIMIT_FIELD_COUNT':
        return {
          statusCode: 413,
          code: 'PAYLOAD_TOO_LARGE',
          message: 'The request exceeds the allowed limits'
        };

      default:
        return {
          statusCode: 400,
          code: 'INVALID_REQUEST',
          message: 'The request is invalid'
        };
    }
  }

  if (error && error.type === 'entity.too.large') {
    return {
      statusCode: 413,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'The request exceeds the allowed limits'
    };
  }

  if (
    error &&
    (
      error.type === 'entity.parse.failed' ||
      error instanceof SyntaxError
    )
  ) {
    return {
      statusCode: 400,
      code: 'INVALID_REQUEST',
      message: 'The request is invalid'
    };
  }

  if (
    error &&
    error.statusCode === 415
  ) {
    return {
      statusCode: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      message: 'The supplied media type is not supported'
    };
  }

  if (
    error &&
    Number.isInteger(error.statusCode) &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  ) {
    return {
      statusCode: error.statusCode,
      code: 'INVALID_REQUEST',
      message: 'The request is invalid'
    };
  }

  return {
    statusCode: 500,
    code: 'INTERNAL_ERROR',
    message: 'The request could not be completed'
  };
}

function logInternalError(error, req) {
  console.error({
    requestId: req.requestId,
    method: req.method,
    path: getRawPath(req.originalUrl),
    errorName: error && error.name
      ? error.name
      : 'Error',
    errorMessage: error && error.message
      ? error.message
      : 'Unknown error'
  });
}

async function removeRequestFiles(req) {
  const files = collectFilesFromRequest(req);

  await Promise.allSettled(
    files.map(function removeFile(file) {
      return fs.promises.unlink(file.path);
    })
  );
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

