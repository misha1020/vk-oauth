import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useVKAuth } from '../src/hooks/useVKAuth';
import { useAuth } from '../src/hooks/useAuth';
import { router } from 'expo-router';

export default function LoginScreen() {
  const { login, isLoading: authLoading, error: authError } = useAuth();
  const { promptAsync, isLoading: vkLoading, isReady, error: vkError } = useVKAuth(
    async ({ token }) => {
      await login({ token });
      router.replace('/home');
    }
  );

  const isLoading = authLoading || vkLoading;
  const error = vkError || authError;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>VK OAuth Demo</Text>

      {error && <Text style={styles.error}>{error}</Text>}

      <Pressable
        style={[styles.button, (!isReady || isLoading) && styles.buttonDisabled]}
        onPress={() => promptAsync()}
        disabled={!isReady || isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Sign in with VK</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 40,
  },
  button: {
    backgroundColor: '#4680C2',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    minWidth: 200,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: 'red',
    marginBottom: 16,
    textAlign: 'center',
  },
});
