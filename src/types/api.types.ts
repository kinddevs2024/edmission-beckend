export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiErrorBody {
  message: string;
  code?: string;
  errors?: Array<{ field: string; message: string }>;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken?: string;
  user: { id: string; email: string; role: string };
  expiresIn?: number;
}
