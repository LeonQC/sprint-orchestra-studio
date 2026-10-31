import { api } from './client';
import type { AskResponseDto, ChatTurnDto } from './aiApi';

export type FeedbackStatus = 'new' | 'reviewing' | 'resolved' | 'dismissed';
export const feedbackStatuses: Record<FeedbackStatus, string> = {
  new: 'New', reviewing: 'In review', resolved: 'Resolved', dismissed: 'Dismissed',
};
export const feedbackReasons: Record<string, string> = {
  incorrect: 'Incorrect answer', incomplete: 'Missing information', sources: 'Wrong or outdated sources',
  irrelevant: 'Didn’t answer my question', style: 'Hard to read', other: 'Something else',
};
export const feedbackCauses: Record<string, string> = {
  retrieval: 'Retrieval', routing: 'Tool selection', freshness: 'Outdated data', generation: 'Answer generation',
  citation: 'Citations', ux: 'Clarity or experience', not_a_bug: 'No confirmed issue', other: 'Other',
};
export interface FeedbackItem {
  id: string; reason: string; comment: string; status: FeedbackStatus;
  reporterId: number; reporterName: string; createdAt: string; updatedAt: string; revision: number;
  question: string; spaceIds: number[];
}
export interface FeedbackDetail extends FeedbackItem {
  rootCause: string; reviewNote: string; expectedAnswer: string; requiredIssueKeys: string[];
  snapshot: {
    answerId: string; issuedAt: number; dataVersion?: string | null;
    request: { question: string; spaceIds: number[]; history?: ChatTurnDto[]; attachmentIssueKeys?: string[] };
    response: AskResponseDto & { structuredEvidence?: string[] };
    servingPromptVersions?: Record<string, string>;
  };
}
export interface FeedbackList {
  items: FeedbackItem[]; total: number; page: number; pageSize: number;
  counts: Record<FeedbackStatus, number>;
  signals: { total: number; helpful: number; reported: number };
}
export type FeedbackReview = Pick<FeedbackDetail, 'status' | 'rootCause' | 'reviewNote' | 'expectedAnswer' | 'requiredIssueKeys' | 'revision'>;

export const feedbackApi = {
  submit: (receipt: string, rating: 'up' | 'down', reason = '', comment = '') =>
    api.post<{ id: string }>('/api/ai-feedback', { receipt, rating, reason, comment }),
  list: (params: { status: string; query: string; page: number }) =>
    api.get<FeedbackList>(`/api/ai-feedback?${new URLSearchParams({ ...params, page: String(params.page) })}`),
  detail: (id: string) => api.get<FeedbackDetail>(`/api/ai-feedback/${id}`),
  review: (id: string, body: FeedbackReview) => api.put<FeedbackDetail>(`/api/ai-feedback/${id}`, body),
  exportCase: (id: string) => api.getBlob(`/api/ai-feedback/${id}/export`),
};
