import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../src/hooks/useAuth';

export default function IndexScreen() {
  const { isLoading, isLoggedIn } = useAuth();

  useEffect(() => {
    if (!isLoading) {
      router.replace(isLoggedIn ? '/home' : '/login');
    }
  }, [isLoading, isLoggedIn]);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" />
    </View>
  );
}
