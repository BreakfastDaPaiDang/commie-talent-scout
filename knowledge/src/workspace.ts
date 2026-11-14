import { now } from './types.ts';
import type { CatalogActor } from './catalog.ts';
import type { KnowledgeBranch, KnowledgeMerge, KnowledgeDiff } from '../../app/shared/knowledge.ts';
import * as records from './workspace/records.ts';
import * as command from './workspace/command.ts';
import * as branches from './workspace/branches.ts';
import * as categories from './workspace/categories.ts';
import * as documents from './workspace/documents.ts';
import * as review_queries from './workspace/review-queries.ts';
import * as reviews from './workspace/reviews.ts';
import * as issue_queries from './workspace/issue-queries.ts';
import * as discussions from './workspace/discussions.ts';
import { createWorkspaceContext, type ServiceContext } from './workspace/context.ts';
// Stable HTTP/MCP adapter. Commands keep their original atomic batch boundary.
export { workspaceSchemas } from './workspace/inputs.ts';
export class KnowledgeWorkspace {
  private readonly context: ServiceContext;
  constructor(readonly db: D1Database, readonly actor: CatalogActor, readonly clock: () => string = now) {
    this.context = createWorkspaceContext(db, actor, clock);
  }
  stmt(sql: string, ...args: unknown[]) {
    return this.context.stmt(sql, ...args);
  }
  get guest() {
    return this.context.guest;
  }
  get identity() {
    return this.context.identity;
  }
  writer() {
    return records.assertWriter(this.context);
  }
  branch(id: string) {
    return records.getBranch(this.context, id);
  }
  editable(b: KnowledgeBranch, version: number) {
    return records.assertEditable(this.context, b, version);
  }
  receipt(id: string, fingerprint?: string) {
    return command.findReceipt(this.context, id, fingerprint);
  }
  command(input: {
    request_id: string;
  }, operation: string, build: (at: string) => Promise<{
    statements: D1PreparedStatement[];
    result: Record<string, unknown>;
  }>) {
    return command.runCommand(this.context, input, operation, build);
  }
  branches() {
    return branches.listBranches(this.context);
  }
  createBranch(input: unknown) {
    return branches.createBranch(this.context, input);
  }
  shareBranch(input: unknown) {
    return branches.shareBranch(this.context, input);
  }
  deleteBranch(input: unknown) {
    return branches.deleteBranch(this.context, input);
  }
  categories(branchId = 'main') {
    return categories.listCategories(this.context, branchId);
  }
  list(input: unknown) {
    return documents.listDocuments(this.context, input);
  }
  document(branchId: string, id: string) {
    return records.getDocument(this.context, branchId, id);
  }
  get(branchId: string, id: string) {
    return documents.readDocument(this.context, branchId, id);
  }
  version(id: string | null) {
    return records.getVersion(this.context, id);
  }
  commit(id: string, b: KnowledgeBranch, message: string, at: string, mergeParent: string | null = null) {
    return records.prepareCommit(this.context, id, b, message, at, mergeParent);
  }
  save(input: unknown) {
    return documents.saveDocument(this.context, input);
  }
  remove(input: unknown) {
    return documents.removeDocument(this.context, input);
  }
  category(branchId: string, id: string) {
    return categories.getCategory(this.context, branchId, id);
  }
  categoryChanges(a: {
    id?: string;
    branch_id: string;
    expected_version?: number;
    name?: string;
    definition: string;
  }, at: string) {
    return categories.prepareCategoryChanges(this.context, a, at);
  }
  editCategory(input: unknown) {
    return categories.editCategory(this.context, input);
  }
  defineCategory(input: unknown) {
    return categories.defineCategory(this.context, input);
  }
  diff(branchId: string) {
    return documents.branchDiff(this.context, branchId);
  }
  mergeRequests() {
    return review_queries.listMergeRequests(this.context);
  }
  qualified() {
    return review_queries.qualifiedMerges(this.context);
  }
  mergeRequest(id: string) {
    return review_queries.getMergeRequest(this.context, id);
  }
  submitReview(input: unknown) {
    return reviews.submitReview(this.context, input);
  }
  propose(input: unknown) {
    return reviews.proposeMerge(this.context, input);
  }
  approve(input: unknown) {
    return reviews.approveMerge(this.context, input);
  }
  accept(input: unknown) {
    return reviews.acceptMerge(this.context, input);
  }
  mergeChanges(m: KnowledgeMerge, at: string, selection: unknown, changeSet3: {
    branch: KnowledgeBranch;
    main: KnowledgeBranch;
    changes: KnowledgeDiff[];
  }) {
    return reviews.mergeChanges(this.context, m, at, selection, changeSet3);
  }
  resolveConflict(input: unknown) {
    return branches.resolveConflict(this.context, input);
  }
  issues(offset = 0) {
    return issue_queries.listIssues(this.context, offset);
  }
  issue(id: string) {
    return issue_queries.getIssue(this.context, id);
  }
  createIssue(input: unknown) {
    return discussions.createIssue(this.context, input);
  }
  categoryPublic(id: string) {
    return categories.isCategoryPublic(this.context, id);
  }
  issueFromComment(input: unknown) {
    return discussions.issueFromComment(this.context, input);
  }
  setIssueState(input: unknown) {
    return discussions.setIssueState(this.context, input);
  }
  comments(query: {
    branch_id?: string;
    document_id?: string;
    category_id?: string;
    issue_id?: string;
    offset?: number;
  }) {
    return discussions.listComments(this.context, query);
  }
  comment(input: unknown) {
    return discussions.addComment(this.context, input);
  }
  history(branchId: string, offset = 0) {
    return branches.branchHistory(this.context, branchId, offset);
  }
  commitDetail(branchId: string, id: string) {
    return branches.commitDetail(this.context, branchId, id);
  }
}
