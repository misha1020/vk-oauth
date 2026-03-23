const path = require('path');
const fs = require('fs');
const { getUsers, findById, findByVkId, createUser } = require('../../src/services/users');

const TEST_FILE = path.join(__dirname, '../../data/users.test.json');

beforeEach(() => {
  fs.writeFileSync(TEST_FILE, '[]');
});

afterAll(() => {
  if (fs.existsSync(TEST_FILE)) fs.unlinkSync(TEST_FILE);
});

describe('users service', () => {
  test('getUsers returns empty array from empty file', () => {
    const users = getUsers(TEST_FILE);
    expect(users).toEqual([]);
  });

  test('createUser adds a user and returns it', () => {
    const user = createUser({ vkId: 12345, firstName: 'Ivan', lastName: 'Petrov' }, TEST_FILE);
    expect(user).toMatchObject({ vkId: 12345, firstName: 'Ivan', lastName: 'Petrov' });
    expect(user.id).toBeDefined();
    expect(user.createdAt).toBeDefined();

    const users = getUsers(TEST_FILE);
    expect(users).toHaveLength(1);
    expect(users[0].vkId).toBe(12345);
  });

  test('findByVkId returns existing user', () => {
    createUser({ vkId: 99999, firstName: 'Anna', lastName: 'Smirnova' }, TEST_FILE);
    const found = findByVkId(99999, TEST_FILE);
    expect(found).toMatchObject({ vkId: 99999, firstName: 'Anna' });
  });

  test('findByVkId returns null for unknown vkId', () => {
    const found = findByVkId(11111, TEST_FILE);
    expect(found).toBeNull();
  });

  test('findById returns existing user by id', () => {
    const created = createUser({ vkId: 77777, firstName: 'Oleg', lastName: 'Ivanov' }, TEST_FILE);
    const found = findById(created.id, TEST_FILE);
    expect(found).toMatchObject({ vkId: 77777, firstName: 'Oleg' });
  });

  test('findById returns null for unknown id', () => {
    const found = findById('nonexistent-id', TEST_FILE);
    expect(found).toBeNull();
  });

  test('createUser does not duplicate if vkId exists — returns existing', () => {
    const first = createUser({ vkId: 12345, firstName: 'Ivan', lastName: 'Petrov' }, TEST_FILE);
    const second = createUser({ vkId: 12345, firstName: 'Ivan', lastName: 'Petrov' }, TEST_FILE);
    expect(second.id).toBe(first.id);

    const users = getUsers(TEST_FILE);
    expect(users).toHaveLength(1);
  });
});
