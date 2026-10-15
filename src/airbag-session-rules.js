'use strict';
const CONFIG = Object.freeze({durationMinutes:80, breakMinutes:10, price:349, secondPrice:199, capacity:10, minFirst:7,minSecond:7,minInterestWithOccupancy:3,minInterestAlone:7,minPaidThird:5});
function canOpenThird({paidFirst,paidSecond,interestThird,capacityFirst=CONFIG.capacity,capacitySecond=CONFIG.capacity,manual=false,settings=CONFIG}) {
 if (manual) return 'manual';
 if(paidFirst >= capacityFirst && paidSecond >= capacitySecond) return 'sold_out';
 if(interestThird >= settings.minInterestAlone) return 'interest';
 if(paidFirst>=settings.minFirst && paidSecond>=settings.minSecond && interestThird>=settings.minInterestWithOccupancy) return 'occupancy_interest';
 return null;
}
function quoteOrder({riders,secondRiders=0,price=CONFIG.price,secondPrice=CONFIG.secondPrice}) {
 if(!Number.isInteger(riders)||riders<1||!Number.isInteger(secondRiders)||secondRiders<0||secondRiders>riders) throw new Error('Invalid rider counts');
 if(!Number.isInteger(price)||price<0||!Number.isInteger(secondPrice)||secondPrice<0) throw new Error('Invalid prices');
 return {totalCzk:riders*price + secondRiders*secondPrice,savedCzk:secondRiders*(price-secondPrice)};
}
function availableCapacity(capacity,paidPlaces,activeHeldPlaces) {
 return Math.max(0,capacity-paidPlaces-activeHeldPlaces);
}
function confirmThird(paid,manual=false,minPaid=CONFIG.minPaidThird) {return manual || paid>=minPaid;}
function slotsForLocalDay(date) {
 // Local wall clock only. Convert using Europe/Prague time-zone when persisting.
 return [{slot:1,start:'10:00',end:'11:20'},{slot:2,start:'11:30',end:'12:50'},{slot:3,start:'13:00',end:'14:20'}].map(x=>({...x,date}));
}
module.exports={CONFIG,canOpenThird,quoteOrder,availableCapacity,confirmThird,slotsForLocalDay};
