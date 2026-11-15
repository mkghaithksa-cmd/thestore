/** Arabic message for a Supabase auth error. */
export function authErrorMessage(error: { code?: string; message?: string; status?: number }): string {
  switch (error.code) {
    case 'otp_expired':
      return 'الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزاً جديداً.'
    case 'over_sms_send_rate_limit':
    case 'over_request_rate_limit':
      return 'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.'
    case 'phone_provider_disabled':
    case 'sms_send_failed':
      return 'خدمة الدخول بالجوال غير مفعّلة حالياً. حاول لاحقاً.'
    case 'signup_disabled':
      return 'التسجيل الجديد غير متاح حالياً.'
    case 'validation_failed':
      return 'رقم الجوال غير صحيح.'
  }
  if (error.status === 429) return 'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.'
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.'
}
