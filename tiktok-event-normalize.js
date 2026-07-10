function pickImageUrl(imageModel) {
  if (!imageModel) return '';
  if (typeof imageModel === 'string') return imageModel;
  if (typeof imageModel.giftPictureUrl === 'string') return imageModel.giftPictureUrl;
  const list = imageModel.urlList || imageModel.mUrls || imageModel.url;
  if (Array.isArray(list) && list.length > 0) return list[0];
  return '';
}

function normalizeTikTokUser(data) {
  if (!data) {
    return { uniqueId: '', nickname: 'user', avatar: '' };
  }

  if (!data.user && (data.uniqueId || data.nickname)) {
    return {
      uniqueId: data.uniqueId || '',
      nickname: data.nickname || data.uniqueId || 'user',
      avatar: data.profilePictureUrl
        || pickImageUrl(data.profilePicture)
        || pickImageUrl(data.profilePictureLarge)
        || pickImageUrl(data.profilePictureMedium)
        || '',
    };
  }

  const user = data.user || data;
  const uniqueId = user.displayId || user.uniqueId || data.uniqueId || '';
  const nickname = user.nickname || uniqueId || 'user';
  const avatar = pickImageUrl(user.avatarLarge)
    || pickImageUrl(user.avatarMedium)
    || pickImageUrl(user.avatarThumb)
    || user.profilePictureUrl
    || '';

  return { uniqueId, nickname, avatar };
}

function normalizeChatEvent(data) {
  const user = normalizeTikTokUser(data);
  const comment = String(data.comment || data.content || '').trim();
  return {
    nickname: user.nickname,
    comment,
    avatar: user.avatar,
  };
}

function normalizeGiftEvent(data) {
  const user = normalizeTikTokUser(data);
  const gift = data.gift || data.giftDetails || {};
  const extended = data.extendedGiftInfo || {};

  const diamonds = Number(
    data.diamondCount
    || gift.diamondCount
    || extended.diamond_count
    || extended.diamondCount
    || 0
  );

  const giftType = Number(
    data.giftType
    ?? gift.giftType
    ?? gift.type
    ?? extended.gift_type
    ?? 1
  );

  const repeatEnd = data.repeatEnd === true || data.repeatEnd === 1;
  const repeatCount = Number(data.repeatCount || data.comboCount || 1) || 1;

  const giftPictureUrl = data.giftPictureUrl
    || pickImageUrl(gift.image)
    || pickImageUrl(gift.icon)
    || pickImageUrl(gift.previewImage)
    || pickImageUrl(extended.image)
    || (Array.isArray(extended.image?.url_list) ? extended.image.url_list[0] : '')
    || pickImageUrl(gift.giftImage)
    || null;

  const giftName = data.giftName
    || gift.name
    || gift.giftName
    || extended.name
    || 'Unknown';

  return {
    user,
    diamonds,
    giftType,
    repeatEnd,
    repeatCount,
    giftPictureUrl,
    giftName,
  };
}

function normalizeLikeEvent(data) {
  const user = normalizeTikTokUser(data);
  const likeCount = Number(data.likeCount || data.count || 1) || 1;
  return { user, likeCount };
}

function normalizeSocialEvent(data) {
  return { user: normalizeTikTokUser(data) };
}

function normalizeBarrageEvent(data) {
  return { user: normalizeTikTokUser(data) };
}

function buildActivityPayload(type, user, extra = {}) {
  const nickname = user?.nickname || user?.uniqueId || 'ผู้ชม';
  return {
    type,
    nickname,
    avatar: user?.avatar || '',
    text: extra.text || '',
    icon: extra.icon || '',
    giftPictureUrl: extra.giftPictureUrl || '',
    count: Number(extra.count) || 0,
  };
}

module.exports = {
  pickImageUrl,
  normalizeTikTokUser,
  normalizeChatEvent,
  normalizeGiftEvent,
  normalizeLikeEvent,
  normalizeSocialEvent,
  normalizeBarrageEvent,
  buildActivityPayload,
};