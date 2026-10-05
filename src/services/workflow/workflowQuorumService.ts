export interface SignatureEntry {
  /** امضاکننده؛ برای امضای جانشین، تفویض‌کننده (v8.0.88، TD-377) */
  userId: number;
  /** v8.0.88 (TD-377): جانشینی که به جای userId امضا کرده */
  signedBy?: number;
  delegationId?: number;
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
      // v8.0.87 (TD-376): گام بی‌نقش (یا نقش بی‌عضو) همان K طراح را می‌خواهد؛ پیش‌تر کمینه ۲ بود
      return Math.max(1, params.kValue || 1);
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
    /**
     * v8.0.87 (TD-376، تصمیم مالک محصول «همه اعضای نقش»): کاربران فعال نقش لازم گام AND_ALL. گام وقتی رد می‌شود که
     * همه آن‌ها امضا کرده باشند؛ امضای کسی بیرون از فهرست (مثلاً ادمین) ثبت می‌شود ولی جای عضوی را پر نمی‌کند.
     */
    memberIds?: number[];
    userId: number;
    /** v8.0.88 (TD-377): کاربری که واقعاً امضا می‌کند وقتی جانشین userId است؛ یک نفر دو امضا نمی‌شمارد */
    actorId?: number;
    delegationId?: number;
    userName?: string;
    userRole?: string;
    comment?: string;
  }): QuorumEvaluationResult {
    const ruleType = this.normalizeRuleType(params.approvalRuleType);
    const members = ruleType === 'AND_ALL' && params.memberIds && params.memberIds.length > 0 ? params.memberIds : null;
    const requiredCount = this.getRequiredSignaturesCount({
      approvalRuleType: ruleType,
      kValue: params.kValue,
      requiredSignaturesCount: members ? members.length : params.requiredSignaturesCount,
      totalCandidatesCount: params.totalCandidatesCount
    });
    const countOf = (signatures: SignatureEntry[]) => members
      ? members.filter(id => signatures.some(s => Number(s.userId) === Number(id))).length
      : signatures.length;

    const existingSignatures = params.existingSignatures || [];
    const actorId = params.actorId ?? params.userId;
    const alreadySigned = existingSignatures.some(s =>
      Number(s.userId) === Number(params.userId) || Number(s.userId) === Number(actorId) || (s.signedBy !== undefined && Number(s.signedBy) === Number(actorId)));

    if (alreadySigned) {
      const quorumMet = countOf(existingSignatures) >= requiredCount;
      return {
        alreadySigned: true,
        quorumMet,
        requiredCount,
        signaturesCount: countOf(existingSignatures),
        signatures: existingSignatures,
        message: 'امضای شما قبلاً برای این مرحله ثبت گردیده است (WF_DUPLICATE_SIGNATURE)'
      };
    }

    const newSignature: SignatureEntry = {
      userId: params.userId,
      userName: params.userName || `کاربر #${params.userId}`,
      userRole: params.userRole || '',
      signedAt: new Date().toISOString(),
      comment: params.comment || '',
      ...(actorId !== params.userId ? { signedBy: actorId, delegationId: params.delegationId } : {})
    };

    const updatedSignatures = [...existingSignatures, newSignature];
    const signaturesCount = countOf(updatedSignatures);
    const quorumMet = ruleType === 'SINGLE' || ruleType === 'OR_ANY' || signaturesCount >= requiredCount;

    return {
      alreadySigned: false,
      quorumMet,
      requiredCount,
      signaturesCount,
      signatures: updatedSignatures,
      message: quorumMet 
        ? `حدنصاب امضاها (${signaturesCount} از ${requiredCount}) با موفقیت تکمیل گردید.`
        : `امضای شما با موفقیت ثبت شد (${signaturesCount} از ${requiredCount} امضا دریافت شد).`
    };
  }
}
