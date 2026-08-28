import { logger } from '../../middleware/logger';

export interface SignatureEntry {
  userId: number;
  userName?: string;
  userRole?: string;
  signedAt: string;
  comment?: string;
}

export interface QuorumProgress {
  approvalRuleType: string; // 'SINGLE' | 'AND_ALL' | 'ALL' | 'OR_ANY' | 'ANY' | 'K_OF_N'
  kValue?: number;
  requiredCount: number;
  signatures: SignatureEntry[];
  status: 'PENDING' | 'FULFILLED';
  updatedAt: string;
}

export interface QuorumEvaluationResult {
  alreadySigned: boolean;
  quorumMet: boolean;
  requiredCount: number;
  signaturesCount: number;
  signatures: SignatureEntry[];
  message?: string;
}

export class WorkflowQuorumService {
  /**
   * Normalize rule type string to canonical type
   */
  static normalizeRuleType(rawType?: string): 'SINGLE' | 'AND_ALL' | 'OR_ANY' | 'K_OF_N' {
    const type = (rawType || 'SINGLE').trim().toUpperCase();
    if (type === 'ALL' || type === 'AND_ALL') return 'AND_ALL';
    if (type === 'ANY' || type === 'OR_ANY') return 'OR_ANY';
    if (type === 'K_OF_N' || type === 'KOFN' || type === 'QUORUM') return 'K_OF_N';
    return 'SINGLE';
  }

  /**
   * Determine required signatures count for a transition
   */
  static getRequiredSignaturesCount(params: {
    approvalRuleType?: string;
    kValue?: number;
    requiredSignaturesCount?: number;
    totalCandidatesCount?: number;
  }): number {
    const ruleType = this.normalizeRuleType(params.approvalRuleType);
    if (ruleType === 'SINGLE' || ruleType === 'OR_ANY') {
      return 1;
    }
    if (ruleType === 'K_OF_N') {
      return Math.max(1, params.kValue || 2);
    }
    if (ruleType === 'AND_ALL') {
      if (params.requiredSignaturesCount && params.requiredSignaturesCount > 0) {
        return params.requiredSignaturesCount;
      }
      if (params.totalCandidatesCount && params.totalCandidatesCount > 0) {
        return params.totalCandidatesCount;
      }
      return Math.max(2, params.kValue || 2);
    }
    return 1;
  }

  /**
   * Add a signature and evaluate if quorum threshold is reached
   */
  static evaluateAndAddSignature(params: {
    approvalRuleType?: string;
    kValue?: number;
    requiredSignaturesCount?: number;
    totalCandidatesCount?: number;
    existingSignatures?: SignatureEntry[];
    userId: number;
    userName?: string;
    userRole?: string;
    comment?: string;
  }): QuorumEvaluationResult {
    const ruleType = this.normalizeRuleType(params.approvalRuleType);
    const requiredCount = this.getRequiredSignaturesCount({
      approvalRuleType: ruleType,
      kValue: params.kValue,
      requiredSignaturesCount: params.requiredSignaturesCount,
      totalCandidatesCount: params.totalCandidatesCount
    });

    const existingSignatures = params.existingSignatures || [];
    const alreadySigned = existingSignatures.some(s => Number(s.userId) === Number(params.userId));

    if (alreadySigned) {
      const quorumMet = existingSignatures.length >= requiredCount;
      return {
        alreadySigned: true,
        quorumMet,
        requiredCount,
        signaturesCount: existingSignatures.length,
        signatures: existingSignatures,
        message: 'امضای شما قبلاً برای این مرحله ثبت گردیده است (WF_DUPLICATE_SIGNATURE)'
      };
    }

    const newSignature: SignatureEntry = {
      userId: params.userId,
      userName: params.userName || `کاربر #${params.userId}`,
      userRole: params.userRole || '',
      signedAt: new Date().toISOString(),
      comment: params.comment || ''
    };

    const updatedSignatures = [...existingSignatures, newSignature];
    const quorumMet = ruleType === 'SINGLE' || ruleType === 'OR_ANY' || updatedSignatures.length >= requiredCount;

    return {
      alreadySigned: false,
      quorumMet,
      requiredCount,
      signaturesCount: updatedSignatures.length,
      signatures: updatedSignatures,
      message: quorumMet 
        ? `حدنصاب امضاها (${updatedSignatures.length} از ${requiredCount}) با موفقیت تکمیل گردید.`
        : `امضای شما با موفقیت ثبت شد (${updatedSignatures.length} از ${requiredCount} امضا دریافت شد).`
    };
  }
}
