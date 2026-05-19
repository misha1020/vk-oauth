import { useCallback, useRef, useState } from "react";
import { authorize as yandexAuthorize } from "../../modules/expo-yandex-sdk";
import { exchangeYandexJwt } from "../services/api";

export interface YandexAuthResult {
  token: string;
}

export function useYandexAuth(onSuccess: (result: YandexAuthResult) => void) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  const authorize = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      const result = await yandexAuthorize();
      if ("cancelled" in result && result.cancelled) {
        setError("Ошибка авторизации через Яндекс");
        return;
      }

      // The native module already fetched the Yandex-signed JWT via getJwt() on Android
      // and via the SDK login result on iOS (Approach A). Raw access token never enters JS.
      const { token } = await exchangeYandexJwt({ jwt: result.jwt });
      onSuccessRef.current({ token });
    } catch (err: any) {
      const raw = err instanceof Error ? err.message : String(err);
      if (/cancel/i.test(raw)) {
        setError("Ошибка авторизации через Яндекс");
      } else {
        const isRussian = /[а-яА-ЯёЁ]/.test(raw);
        setError(isRussian ? raw : "Ошибка авторизации через Яндекс");
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { authorize, isLoading, error };
}
