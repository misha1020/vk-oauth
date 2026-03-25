import { useCallback, useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import { authorize } from "../../modules/expo-vk-sdk";
import { exchangeVKCode } from "../services/api";

function base64urlEncode(array: Uint8Array): string {
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function generateCodeVerifier(): Promise<string> {
  const array = new Uint8Array(32);
  Crypto.getRandomValues(array);
  return base64urlEncode(array);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 }
  );
  return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export interface VKAuthResult {
  token: string;
}

export function useVKSDKAuth(onSuccess: (result: VKAuthResult) => void) {
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

      const stateArray = new Uint8Array(16);
      Crypto.getRandomValues(stateArray);
      const state = base64urlEncode(stateArray);

      const { code, deviceId } = await authorize(codeChallenge, state);

      const { token } = await exchangeVKCode({
        code,
        codeVerifier,
        deviceId,
      });

      onSuccessRef.current({ token });
    } catch (err: any) {
      setError(err.message || "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { promptAsync, isLoading, isReady: true, error };
}
