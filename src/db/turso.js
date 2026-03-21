/**
 * turso.js — libsql/Turso client singleton
 * Reads TURSO_URL + TURSO_AUTH_TOKEN from environment.
 */
'use strict';

const { createClient } = require('@libsql/client');

const url       = process.env.TURSO_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) throw new Error('TURSO_URL is not set in .env');

const client = createClient({ url, authToken: authToken || undefined });

module.exports = client;
