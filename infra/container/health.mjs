const path=process.argv[2]==='/health/live'?'/health/live':'/health/ready';
const response=await fetch(`http://127.0.0.1:3000${path}`,{signal:AbortSignal.timeout(3000)});
if(!response.ok) process.exit(1);
