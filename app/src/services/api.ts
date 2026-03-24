import { API_URL } from '../config';

interface MeResponse {
  user: {
    id: string;
    vkId: number;
    firstName: string;
    lastName: string;
  };
}

export async function getMe(token: string): Promise<MeResponse> {
  const res = await fetch(`${API_URL}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    throw new Error('Invalid token');
  }

  return res.json();
}
