export const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';
export const GIVEN_CHARS = '伟芳娜秀英敏静丽强磊军洋勇艳杰娟涛明超霞平刚桂英华玉兰春梅文辉建国建华志强志明海燕涵梓萱浩然欣怡雨桐嘉懿俊驰雨泽烨磊晟睿天佑文昊修洁黎昕远航旭尧鸿涛伟祺荣轩越泽浩宇瑾瑜皓轩擎苍擎宇志泽睿渊楷瑞晨曦梦琪忆柳之瑶碧萱曼柔乐菱幼南夜蓉';
export const PHONE_PREFIXES = ['130','131','132','133','134','135','136','137','138','139','145','146','147','148','149','150','151','152','153','155','156','157','158','159','162','165','166','167','170','171','172','173','175','176','177','178','180','181','182','183','184','185','186','187','188','189','190','191','192','193','195','196','197','198','199'];
export const LANDLINE_AREACODES = ['010','020','021','022','023','024','025','027','028','029','0512','0532','0571','0755','0769','0371','0731','0592'];
export const EMAIL_NAMES = ['test','dev','qa','demo','user','faker','form','sample','hello','work'];
export const EMAIL_DOMAINS = ['qq.com','163.com','126.com','gmail.com','outlook.com','foxmail.com','sina.com'];
export const COMPANY_WORDS = ['星辰','云海','天宇','恒信','嘉禾','瑞丰','联创','博远','中科','华信','蓝湾','绿洲','启航','卓越','宏图','润泽','选课爱','蜜雪'];
export const COMPANY_INDUSTRIES = ['科技','贸易','实业','智能','网络','信息','物流','商贸','制造','电子'];
export const COMPANY_FORMS = ['有限公司','有限责任公司','股份有限公司'];
export const STREET_NAMES = ['中山路','人民路','建设路','解放路','文化路','科技园路','滨江道','兴华街','创新大道','学府路'];
export const PARAGRAPH_SENTENCES = [
  '公司成立于二〇一〇年，主营业务覆盖华东与华南地区。',
  '已通过 ISO9001 质量管理体系认证。',
  '现有员工三百余人，其中研发人员占比超过百分之三十。',
  '年营业额稳定增长，客户满意度持续保持较高水平。',
  '与多家大型企业建立长期稳定合作关系。',
  '拥有多项自主知识产权与软件著作权。',
  '生产线配备自动化检测设备，产能充足。',
  '售后服务网络覆盖全国主要城市。',
  '注重技术创新，每年研发投入占营收百分之八以上。',
  '产品远销东南亚与欧洲市场，出口额逐年上升。',
];
export const GENDERS = ['男', '女'];
export const EDUCATIONS = ['博士', '硕士', '本科', '大专', '高中'];

export const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
export const digits = (n: number): string => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
export const intBetween = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1));
