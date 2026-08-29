/**
 * 纯 JS 技术指标计算引擎 (MA / BOLL / EMA / VOL MA / MACD / RSI / KDJ)
 */
function calculateIndicators(bars) {
  if (!Array.isArray(bars) || bars.length === 0) {
    return {
      dates: [], kValues: [], volumes: [],
      ma5: [], ma10: [], ma20: [], ma60: [],
      volMa5: [], volMa10: [],
      bollMid: [], bollUpper: [], bollLower: [],
      ema12: [], ema26: [],
      dif: [], dea: [], macdBar: [],
      rsi6: [], rsi12: [], rsi24: [],
      kdjK: [], kdjD: [], kdjJ: []
    };
  }
  const dates = bars.map(b => b.time);
  const kValues = bars.map(b => [b.open, b.close, b.low, b.high]);
  const closes = bars.map(b => b.close);
  const highs = bars.map(b => b.high);
  const lows = bars.map(b => b.low);
  const volumes = bars.map(b => b.volume);

  const calcMA = (dayCount) => {
    const result = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < dayCount - 1) {
        result.push('-');
        continue;
      }
      let sum = 0;
      for (let j = 0; j < dayCount; j++) sum += closes[i - j];
      result.push(+(sum / dayCount).toFixed(2));
    }
    return result;
  };

  const ma5 = calcMA(5);
  const ma10 = calcMA(10);
  const ma20 = calcMA(20);
  const ma60 = calcMA(60);

  // VOL MA
  const calcVolMA = (count) => {
    const result = [];
    for (let i = 0; i < volumes.length; i++) {
      if (i < count - 1) {
        result.push('-');
        continue;
      }
      let sum = 0;
      for (let j = 0; j < count; j++) sum += volumes[i - j];
      result.push(Math.round(sum / count));
    }
    return result;
  };
  const volMa5 = calcVolMA(5);
  const volMa10 = calcVolMA(10);

  // BOLL(20, 2)
  const bollMid = [];
  const bollUpper = [];
  const bollLower = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < 19) {
      bollMid.push('-');
      bollUpper.push('-');
      bollLower.push('-');
      continue;
    }
    let sum = 0;
    for (let j = 0; j < 20; j++) sum += closes[i - j];
    const ma = sum / 20;
    let variance = 0;
    for (let j = 0; j < 20; j++) variance += Math.pow(closes[i - j] - ma, 2);
    const std = Math.sqrt(variance / 20);
    bollMid.push(+ma.toFixed(2));
    bollUpper.push(+(ma + 2 * std).toFixed(2));
    bollLower.push(+(ma - 2 * std).toFixed(2));
  }

  // EMA(12, 26)
  const calcEMA = (span) => {
    const k = 2 / (span + 1);
    const result = [];
    let prev = closes[0] || 0;
    for (let i = 0; i < closes.length; i++) {
      const val = i === 0 ? closes[0] : (closes[i] * k + prev * (1 - k));
      result.push(+val.toFixed(2));
      prev = val;
    }
    return result;
  };
  const ema12 = calcEMA(12);
  const ema26 = calcEMA(26);

  // MACD (12, 26, 9)
  const dif = [];
  for (let i = 0; i < closes.length; i++) {
    dif.push(+(ema12[i] - ema26[i]).toFixed(2));
  }
  const k9 = 2 / (9 + 1);
  const dea = [];
  let prevDea = dif[0] || 0;
  for (let i = 0; i < dif.length; i++) {
    const val = i === 0 ? dif[0] : (dif[i] * k9 + prevDea * (1 - k9));
    dea.push(+val.toFixed(2));
    prevDea = val;
  }
  const macdBar = dif.map((d, i) => +((d - dea[i]) * 2).toFixed(2));

  // RSI(6, 12, 24)
  const calcRSI = (n) => {
    const result = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < n) {
        result.push('-');
        continue;
      }
      let gain = 0, loss = 0;
      for (let j = 0; j < n; j++) {
        const diff = closes[i - j] - closes[i - j - 1];
        if (diff >= 0) gain += diff;
        else loss += Math.abs(diff);
      }
      if (loss === 0) result.push(100);
      else {
        const rs = (gain / n) / (loss / n);
        result.push(+(100 - (100 / (1 + rs))).toFixed(2));
      }
    }
    return result;
  };
  const rsi6 = calcRSI(6);
  const rsi12 = calcRSI(12);
  const rsi24 = calcRSI(24);

  // KDJ(9, 3, 3)
  const kdjK = [];
  const kdjD = [];
  const kdjJ = [];
  let lastK = 50, lastD = 50;
  for (let i = 0; i < closes.length; i++) {
    const start = Math.max(0, i - 8);
    let l9 = Infinity, h9 = -Infinity;
    for (let j = start; j <= i; j++) {
      l9 = Math.min(l9, lows[j]);
      h9 = Math.max(h9, highs[j]);
    }
    const rsv = (h9 === l9) ? 50 : ((closes[i] - l9) / (h9 - l9)) * 100;
    const currK = (2 / 3) * lastK + (1 / 3) * rsv;
    const currD = (2 / 3) * lastD + (1 / 3) * currK;
    const currJ = 3 * currK - 2 * currD;

    kdjK.push(+currK.toFixed(2));
    kdjD.push(+currD.toFixed(2));
    kdjJ.push(+currJ.toFixed(2));
    lastK = currK;
    lastD = currD;
  }

  return {
    dates,
    kValues,
    volumes,
    ma5, ma10, ma20, ma60,
    volMa5, volMa10,
    bollMid, bollUpper, bollLower,
    ema12, ema26,
    dif, dea, macdBar,
    rsi6, rsi12, rsi24,
    kdjK, kdjD, kdjJ
  };
}

const INDICATOR_GUIDES = {
  MA: {
    fullName: '移动平均线 (Moving Average)',
    summary: '最经典的趋势追踪指标，反映股票不同周期平均成交成本。',
    howToUse: '• 多头排列：MA5/10 > MA20/60 且向上发散，代表强劲上升趋势。\n• 金叉与死叉：MA5 上穿 MA20 为买点，下穿为减仓点。\n• 均线支撑：回踩均线不破为加仓良机。'
  },
  BOLL: {
    fullName: '布林线通道 (Bollinger Bands)',
    summary: '由上轨、中轨(MA20)和下轨组成的价格波动区间。',
    howToUse: '• 支撑与阻力：触及下轨反弹为超跌买点，触及上轨遇阻为止盈点。\n• 喇叭口收窄：通道极度变窄预示即将发生单边剧烈突破。'
  },
  EMA: {
    fullName: '指数移动平均线 (Exponential MA)',
    summary: '赋予近期价格更高权重的均线，比普通 MA 反应更灵敏。',
    howToUse: '• EMA12 上穿 EMA26 为短线多头确立买点；下穿为空头卖点。'
  },
  VOL: {
    fullName: '成交量与均量线 (Volume)',
    summary: '反映市场资金交投活跃度与动能的核心量价指标。',
    howToUse: '• 量增价涨：资金积极进场，健康上升动能。\n• 缩量回调：主力洗盘良机；放量大阴线需警惕出逃。\n• 天量滞涨：高位巨量但涨不动，警惕诱多出货。'
  },
  MACD: {
    fullName: '平滑异同移动平均线 (MACD)',
    summary: '动量与中短线趋势之王，由 DIF、DEA 与 红绿柱 组成。',
    howToUse: '• 零轴金叉：DIF 上穿 DEA 在 0 轴上方金叉为最强买点。\n• 红绿柱动能：红柱拉长多头加速，红柱缩短动能衰竭。\n• 顶底背离：股价创新高但 MACD 不创新高为顶背离（强烈看跌）。'
  },
  RSI: {
    fullName: '相对强弱指标 (Relative Strength Index)',
    summary: '衡量买卖盘双方力量强弱与超买超卖的摆动指标（0~100）。',
    howToUse: '• 超买区（RSI>80）：市场过热狂热，随时可能发生技术性回调。\n• 超卖区（RSI<20）：市场极度悲观，孕育超跌反弹。\n• 50 为多空分水岭。'
  },
  KDJ: {
    fullName: '随机指标 (Stochastic Oscillator)',
    summary: '捕捉短线波段拐点最灵敏的指标（0~100）。',
    howToUse: '• 低位金叉：在 20 以下 K 线上穿 D 线形成金叉为短线买入点。\n• 高位死叉：在 80 以上高位形成死叉为短线卖出点。\n• J>100 极度超买，J<0 极度超卖。'
  }
};

if (typeof window !== 'undefined') {
  window.calculateIndicators = calculateIndicators;
  window.INDICATOR_GUIDES = INDICATOR_GUIDES;
}
