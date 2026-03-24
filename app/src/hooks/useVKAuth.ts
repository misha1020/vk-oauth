import { useCallback, useRef, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { VK_CLIENT_ID, API_URL } from '../config';

function base64urlEncode(array: Uint8Array): string {
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function generateCodeVerifier(): Promise<string> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(new Uint8Array(hash));
}

function generateDeviceId(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

export interface VKAuthResult {
  token: string;
}

export function useVKAuth(onSuccess: (result: VKAuthResult) => void) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const promptAsync = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const codeVerifier = await generateCodeVerifier();
      const codeChallenge = await generateCodeChallenge(codeVerifier);
      const deviceId = generateDeviceId();
      const redirectUri = `${API_URL}/auth/vk/callback`;

      // Encode code_verifier + device_id in state so server can retrieve them from callback
      const state = btoa(JSON.stringify({ code_verifier: codeVerifier, device_id: deviceId }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

      const params = new URLSearchParams({
        client_id: VK_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 's256',
        scope: 'email',
        display: 'mobile',
      });

      const result = await WebBrowser.openAuthSessionAsync(
        `https://id.vk.com/authorize?${params.toString()}`,
        'vkoauth://'
      );

      if (result.type === 'success') {
        if (result.url.startsWith('vkoauth://auth/success')) {
          const tokenMatch = result.url.match(/token=([^&]+)/);
          const token = tokenMatch ? decodeURIComponent(tokenMatch[1]) : null;
          if (token) {
            onSuccessRef.current({ token });
          } else {
            setError('Token missing from redirect');
          }
        } else if (result.url.startsWith('vkoauth://auth/error')) {
          const msgMatch = result.url.match(/message=([^&]+)/);
          setError(msgMatch ? decodeURIComponent(msgMatch[1]) : 'Authentication failed');
        }
      }
      // type === 'cancel' or 'dismiss' → user closed browser, no-op
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { promptAsync, isLoading, isReady: true, error };
}
