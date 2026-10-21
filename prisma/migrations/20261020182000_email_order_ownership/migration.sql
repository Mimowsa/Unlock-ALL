-- An order delivery job must belong to the same customer as the order.
CREATE UNIQUE INDEX "Order_id_userId_key" ON "Order"("id", "userId");
ALTER TABLE "EmailJob" DROP CONSTRAINT "EmailJob_orderId_fkey";
ALTER TABLE "EmailJob" ADD CONSTRAINT "EmailJob_orderId_userId_fkey"
  FOREIGN KEY ("orderId", "userId") REFERENCES "Order"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
