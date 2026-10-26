'use strict';
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const { createHandler } = require('./handler');
exports.main = createHandler(cloud);
