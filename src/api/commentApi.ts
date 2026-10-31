import { api } from './client';
import type { CommentDto } from './issueApi';

export interface CreateCommentRequest {
  authorId: number;
  content: string;
  /** Replying to a reply is fine; the server attaches it to that reply's top-level comment. */
  parentId?: number;
}

export const commentApi = {
  getByIssue: (issueId: number) =>
    api.get<CommentDto[]>(`/api/issues/${issueId}/comments`),
  create: (issueId: number, req: CreateCommentRequest) =>
    api.post<CommentDto>(`/api/issues/${issueId}/comments`, req),
  update: (issueId: number, commentId: number, content: string) =>
    api.put<CommentDto>(`/api/issues/${issueId}/comments/${commentId}`, { content }),
  delete: (issueId: number, commentId: number) =>
    api.delete<void>(`/api/issues/${issueId}/comments/${commentId}`),
};
