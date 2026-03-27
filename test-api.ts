const BASE_URL = 'https://www.modelscope.cn/studios/eclipse1302/Duo-Journal';

async function testAll() {
  console.log('=== 测试 /api/agent/comment ===');
  try {
    const res1 = await fetch(`${BASE_URL}/api/agent/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '今天心情不错，阳光很好', style: 'Neutral' }),
    });
    const text1 = await res1.text();
    console.log('Status:', res1.status);
    console.log('Content-Type:', res1.headers.get('content-type'));
    console.log('Body:', text1.substring(0, 200)); // 只打印前200字符
  } catch (e) {
    console.error('Error:', e);
  }

  console.log('\n=== 测试 /api/agent/score ===');
  try {
    const res2 = await fetch(`${BASE_URL}/api/agent/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '今天心情不错，阳光很好', style: 'Neutral' }),
    });
    const text2 = await res2.text();
    console.log('Status:', res2.status);
    console.log('Content-Type:', res2.headers.get('content-type'));
    console.log('Body:', text2.substring(0, 200));
  } catch (e) {
    console.error('Error:', e);
  }

  console.log('\n=== 测试 /api/agent/chat ===');
  try {
    const res3 = await fetch(`${BASE_URL}/api/agent/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: '今天心情不错',
        history: [],
        message: '你觉得我该做什么？',
        style: 'Neutral',
      }),
    });
    const text3 = await res3.text();
    console.log('Status:', res3.status);
    console.log('Content-Type:', res3.headers.get('content-type'));
    console.log('Body:', text3.substring(0, 200));
  } catch (e) {
    console.error('Error:', e);
  }
}

testAll();