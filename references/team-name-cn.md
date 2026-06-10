# 球队中英文名映射表

生成报告、可视化页面或海报时，所有球队名称必须使用中文，禁止出现英文队名。

## 48 队完整映射

| 英文名 | 中文名 |
|--------|--------|
| Mexico | 墨西哥 |
| South Africa | 南非 |
| South Korea | 韩国 |
| Czech Republic | 捷克 |
| Canada | 加拿大 |
| Bosnia and Herzegovina | 波黑 |
| Qatar | 卡塔尔 |
| Switzerland | 瑞士 |
| Brazil | 巴西 |
| Morocco | 摩洛哥 |
| Haiti | 海地 |
| Scotland | 苏格兰 |
| United States | 美国 |
| Paraguay | 巴拉圭 |
| Australia | 澳大利亚 |
| Turkey | 土耳其 |
| Germany | 德国 |
| Curaçao | 库拉索 |
| Ivory Coast | 科特迪瓦 |
| Ecuador | 厄瓜多尔 |
| Netherlands | 荷兰 |
| Japan | 日本 |
| Sweden | 瑞典 |
| Tunisia | 突尼斯 |
| Belgium | 比利时 |
| Egypt | 埃及 |
| Iran | 伊朗 |
| New Zealand | 新西兰 |
| Spain | 西班牙 |
| Cape Verde | 佛得角 |
| Saudi Arabia | 沙特 |
| Uruguay | 乌拉圭 |
| France | 法国 |
| Senegal | 塞内加尔 |
| Iraq | 伊拉克 |
| Norway | 挪威 |
| Argentina | 阿根廷 |
| Algeria | 阿尔及利亚 |
| Austria | 奥地利 |
| Jordan | 约旦 |
| Portugal | 葡萄牙 |
| DR Congo | 刚果金 |
| Uzbekistan | 乌兹别克斯坦 |
| Colombia | 哥伦比亚 |
| England | 英格兰 |
| Croatia | 克罗地亚 |
| Ghana | 加纳 |
| Panama | 巴拿马 |

## 快速替换（Python）

```python
CN = {
    "Mexico":"墨西哥","South Africa":"南非","South Korea":"韩国","Czech Republic":"捷克",
    "Canada":"加拿大","Bosnia and Herzegovina":"波黑","Qatar":"卡塔尔","Switzerland":"瑞士",
    "Brazil":"巴西","Morocco":"摩洛哥","Haiti":"海地","Scotland":"苏格兰",
    "United States":"美国","Paraguay":"巴拉圭","Australia":"澳大利亚","Turkey":"土耳其",
    "Germany":"德国","Curaçao":"库拉索","Ivory Coast":"科特迪瓦","Ecuador":"厄瓜多尔",
    "Netherlands":"荷兰","Japan":"日本","Sweden":"瑞典","Tunisia":"突尼斯",
    "Belgium":"比利时","Egypt":"埃及","Iran":"伊朗","New Zealand":"新西兰",
    "Spain":"西班牙","Cape Verde":"佛得角","Saudi Arabia":"沙特","Uruguay":"乌拉圭",
    "France":"法国","Senegal":"塞内加尔","Iraq":"伊拉克","Norway":"挪威",
    "Argentina":"阿根廷","Algeria":"阿尔及利亚","Austria":"奥地利","Jordan":"约旦",
    "Portugal":"葡萄牙","DR Congo":"刚果金","Uzbekistan":"乌兹别克斯坦","Colombia":"哥伦比亚",
    "England":"英格兰","Croatia":"克罗地亚","Ghana":"加纳","Panama":"巴拿马",
}
def cn(t): return CN.get(t, t)

# 替换 matchupNotes / tactical profiles 等字段中的英文队名
notes = "... original text with English team names ..."
for eng, ch in sorted(CN.items(), key=lambda x: -len(x[0])):
    notes = notes.replace(eng, ch)
```

## 覆盖范围

包括但不限于：
- 赛程表
- 预测概率表
- 夺冠概率排行
- 小组出线表
- 赔率对比表
- 体彩推荐
- 战术分析备注（matchupNotes）
- HTML 可视化页面中的所有球队名称
