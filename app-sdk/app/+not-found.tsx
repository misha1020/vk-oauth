import { useEffect } from "react";
import { router } from "expo-router";

export default function NotFoundScreen() {
  useEffect(() => {
    router.replace("/");
  }, []);

  return null;
}
