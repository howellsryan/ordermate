namespace ordermateAPI.DAL.Scripts;

public class OrderItemScripts
{
    public static string Get = "SELECT * FROM OrderItems WHERE OrderItemId = @orderItemId;";
    public static string GetByOrderIdAndProductOptionId = "SELECT * FROM OrderItems WHERE OrderId = @orderId AND ProductOptionId = @productOptionId;";
    public static string GetAllByOrderId = "SELECT * FROM OrderItems WHERE OrderId = @orderId;";
    
    public static string AddItemToOrder = "INSERT INTO OrderItems (OrderId, ProductOptionId, Quantity, CreatedDate, LastModifiedDate) VALUES (@orderId, @productOptionId, @quantity, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) SELECT CAST(SCOPE_IDENTITY() AS INT);";

    public static string UpdateOrderItem = "UPDATE OrderItems SET Quantity = @quantity, LastModifiedDate = CURRENT_TIMESTAMP WHERE OrderItemId = @orderItemId;";
    
    public static string RemoveOrderItemAndModifiers = "DELETE FROM OrderItemModifiers WHERE OrderItemId = @orderItemId; DELETE FROM OrderItems WHERE OrderItemId = @orderItemId;";
}