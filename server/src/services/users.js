const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_FILE = path.join(__dirname, '../../data/users.json');

function getUsers(filePath = DEFAULT_FILE) {
  const data = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(data);
}

function saveUsers(users, filePath = DEFAULT_FILE) {
  fs.writeFileSync(filePath, JSON.stringify(users, null, 2));
}

function findById(id, filePath = DEFAULT_FILE) {
  const users = getUsers(filePath);
  return users.find((u) => u.id === id) || null;
}

function findByVkId(vkId, filePath = DEFAULT_FILE) {
  const users = getUsers(filePath);
  return users.find((u) => u.vkId === vkId) || null;
}

function createUser({ vkId, firstName, lastName }, filePath = DEFAULT_FILE) {
  const existing = findByVkId(vkId, filePath);
  if (existing) return existing;

  const users = getUsers(filePath);
  const user = {
    id: crypto.randomUUID(),
    vkId,
    firstName,
    lastName,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveUsers(users, filePath);
  return user;
}

module.exports = { getUsers, findById, findByVkId, createUser };
