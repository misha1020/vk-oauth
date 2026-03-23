const { exchangeCode, fetchUserProfile } = require('../../src/services/vk');

// Mock global fetch
global.fetch = jest.fn();

beforeEach(() => {
  fetch.mockReset();
});

describe('vk service', () => {
  describe('exchangeCode', () => {
    test('returns tokens on successful exchange', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'vk-access-token',
          user_id: 12345,
          id_token: 'some-id-token',
        }),
      });

      const result = await exchangeCode({
        code: 'auth-code',
        codeVerifier: 'verifier',
        deviceId: 'device-123',
        redirectUri: 'vkoauth://auth/vk',
        clientId: 'app-id',
        clientSecret: 'app-secret',
      });

      expect(result).toEqual({
        accessToken: 'vk-access-token',
        userId: 12345,
        idToken: 'some-id-token',
      });

      // Verify fetch was called with correct URL and form body
      expect(fetch).toHaveBeenCalledWith(
        'https://id.vk.com/oauth2/auth',
        expect.objectContaining({ method: 'POST' })
      );
    });

    test('throws on VK error response', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          error: 'invalid_grant',
          error_description: 'Code expired',
        }),
      });

      await expect(
        exchangeCode({
          code: 'bad-code',
          codeVerifier: 'verifier',
          deviceId: 'device-123',
          redirectUri: 'vkoauth://auth/vk',
          clientId: 'app-id',
          clientSecret: 'app-secret',
        })
      ).rejects.toThrow('Code expired');
    });
  });

  describe('fetchUserProfile', () => {
    test('returns user profile from VK ID user_info endpoint', async () => {
      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          user: {
            user_id: '12345',
            first_name: 'Ivan',
            last_name: 'Petrov',
          },
        }),
      });

      const profile = await fetchUserProfile('vk-access-token', 'test-client-id');
      expect(profile).toEqual({ vkId: 12345, firstName: 'Ivan', lastName: 'Petrov' });
    });
  });
});
