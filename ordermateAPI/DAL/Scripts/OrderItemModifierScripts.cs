namespace ordermateAPI.DAL.Scripts;

public class OrderItemModifierScripts
{
    public static string GetByOrderItemIdAndModifierId = "SELECT * FROM OrderItemModifiers WHERE OrderItemId = @orderItemId AND ModifierId = @modifierId;";
    public static string GetAllByOrderItem = "SELECT * FROM OrderItemModifiers WHERE OrderItemId = @orderItemId;";
    
    public static string AddModifierToOrderItem = "INSERT INTO OrderItemModifiers (OrderItemId, ModifierId, Quantity, CreatedDate, LastModifiedDate) VALUES (@orderItemId, @modifierId, @quantity, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);";
    
    public static string UpdateOrderItemModifier = "UPDATE OrderItemModifiers SET Quantity = @quantity, LastModifiedDate = CURRENT_TIMESTAMP WHERE OrderItemId = @orderItemId;";
}